import { Hono } from "hono";
import { alertWindow, deadlineMessages, type Deadline } from "../../shared/deadlines";
import { HttpError, type AppEnv, type Bindings } from "../env";
import { isPushEndpoint, sendPush, type PushMessage, type PushTarget, type VapidKeys } from "../lib/webpush";

// Phone/browser notifications. The page subscribes through the browser's push service and
// saves the subscription here; the hourly cron sends deadline alerts to every subscription.

function vapidKeys(env: Bindings): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

/** Sends a message to every saved subscription and drops the ones the push service says are gone. */
export async function notifyAll(env: Bindings, message: PushMessage) {
  const keys = vapidKeys(env);
  if (!keys) throw new HttpError(503, "Notifications aren't set up (VAPID keys missing)");
  const { results } = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions").all<PushTarget>();
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const target of results) {
    const status = await sendPush(target, message, keys).catch(() => 0);
    if (status >= 200 && status < 300) {
      sent++;
      await env.DB.prepare("UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ?").bind(Date.now(), target.endpoint).run();
    } else if (status === 404 || status === 410) {
      removed++;
      await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(target.endpoint).run();
    } else {
      failed++;
      console.warn(`push to ${new URL(target.endpoint).hostname} failed: ${status}`);
    }
  }
  return { sent, failed, removed };
}

/** Hourly cron: at 8 AM, what's due today; at 7 PM, what's due tomorrow. */
export async function sendDeadlineAlerts(env: Bindings, now: number) {
  const window = alertWindow(now);
  if (!window || !vapidKeys(env)) return;

  // A retried cron run must not alert twice.
  const logKey = `deadlines:${window.when}:${window.day}`;
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO push_log (key, sent_at) VALUES (?, ?)").bind(logKey, now).run();
  if (!claimed.meta.changes) return;

  const [tasks, jobs] = await Promise.all([
    env.DB.prepare("SELECT id, title FROM tasks WHERE done = 0 AND due = ? ORDER BY created_at").bind(window.day).all<{ id: string; title: string }>(),
    env.DB.prepare("SELECT id, company, next_step FROM applications WHERE next_step_on = ? AND stage != 'rejected' ORDER BY updated_at DESC")
      .bind(window.day)
      .all<{ id: string; company: string; next_step: string | null }>(),
  ]);
  const items: Deadline[] = [
    ...tasks.results.map((t) => ({ kind: "task" as const, id: t.id, title: t.title })),
    ...jobs.results.map((j) => ({ kind: "job" as const, id: j.id, title: j.next_step ? `${j.company}: ${j.next_step}` : j.company })),
  ];
  for (const message of deadlineMessages(items, window.when, window.day)) await notifyAll(env, message);
}

const push = new Hono<AppEnv>();

push.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT count(*) AS n FROM push_subscriptions").first<{ n: number }>();
  return c.json({ publicKey: vapidKeys(c.env)?.publicKey ?? null, subscriptions: row?.n ?? 0 });
});

push.post("/subscribe", async (c) => {
  const body = await c.req.json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string }; label?: string }>();
  const { endpoint, keys } = body;
  if (!endpoint || !isPushEndpoint(endpoint)) throw new HttpError(400, "Not a supported push service", "bad_request");
  if (!keys?.p256dh || !keys.auth || !/^[\w-]{80,100}$/.test(keys.p256dh) || !/^[\w-]{16,32}$/.test(keys.auth)) throw new HttpError(400, "Missing subscription keys", "bad_request");
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
  )
    .bind(endpoint, keys.p256dh, keys.auth, body.label?.slice(0, 60) ?? null, Date.now())
    .run();
  return c.json({ ok: true });
});

push.post("/unsubscribe", async (c) => {
  const { endpoint } = await c.req.json<{ endpoint?: string }>();
  if (endpoint) await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
  return c.json({ ok: true });
});

push.post("/test", async (c) => {
  const result = await notifyAll(c.env, { title: "Deadline alerts are on", body: "You'll hear about tasks and application steps due at 7 PM the day before and 8 AM on the day.", url: "/", tag: "test" });
  return c.json(result);
});

export default push;
