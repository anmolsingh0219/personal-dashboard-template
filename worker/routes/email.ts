import { Hono } from "hono";
import type { EmailResponse } from "../../shared/types";
import { HttpError, type AppEnv, type Bindings } from "../env";
import { loadBrief } from "../lib/brief";
import { METADATA_HEADERS, triage, type GmailThread } from "../lib/emailRules";
import { batchGet } from "../lib/gmailBatch";
import { getGoogleSession, gfetch, requireGoogle, SCOPES, type GoogleSession } from "../lib/google";
import { cached, getSettings } from "../lib/store";

const INBOX_QUERY = "in:inbox newer_than:21d -in:chats";
const SENT_QUERY = "in:sent newer_than:30d older_than:2d";

const email = new Hono<AppEnv>();

async function liveTriage(env: Bindings, session: GoogleSession, bypassCache: boolean): Promise<EmailResponse> {
  const settings = await getSettings(env.DB);
  const aliases = settings.emailAliases.split(/[,\s]+/).filter(Boolean);
  return cached<EmailResponse>(
    env.DB,
    "email:triage",
    3 * 60_000,
    async () => {
      const list = (q: string) =>
        gfetch<{ threads?: { id: string }[] }>(session, `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=40&q=${encodeURIComponent(q)}`);
      const [inbox, sent] = await Promise.all([list(INBOX_QUERY), list(SENT_QUERY)]);
      const ids = [...new Set([...(inbox.threads ?? []), ...(sent.threads ?? [])].map((t) => t.id))];
      const headers = METADATA_HEADERS.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join("&");
      const threads = await batchGet<GmailThread>(session, ids.map((id) => `/gmail/v1/users/me/threads/${id}?format=metadata&${headers}`));
      return { account: session.email, ...triage(threads, session.email, aliases, Date.now()), fetchedAt: Date.now(), source: "google" };
    },
    bypassCache,
  );
}

email.get("/", async (c) => {
  const session = await getGoogleSession(c.env).catch(() => null);
  let data: EmailResponse;
  if (session?.scopes.has(SCOPES.gmail)) {
    data = await liveTriage(c.env, session, c.req.query("refresh") === "1");
  } else {
    // No direct Gmail access: fall back to the scheduled Claude task's snapshot.
    const brief = await loadBrief(c.env.DB);
    if (!brief) {
      await requireGoogle(c.env, SCOPES.gmail); // throws "connect Google" or "permission missing"
      throw new HttpError(409, "Connect your Google account first.", "google_not_connected");
    }
    data = { account: brief.account, needsReply: brief.needsReply, waitingOn: brief.waitingOn, fetchedAt: brief.generatedAt, source: "claude" };
  }

  // Dismissals are applied after the cache so "done" takes effect immediately.
  const { results: dismissed } = await c.env.DB.prepare("SELECT thread_id, last_message_id, snooze_until FROM email_dismissed").all<{
    thread_id: string;
    last_message_id: string;
    snooze_until: number | null;
  }>();
  const hidden = new Map(dismissed.map((d) => [d.thread_id, d]));
  const now = Date.now();
  const visible = (t: { threadId: string; lastMessageId: string }) => {
    const d = hidden.get(t.threadId);
    if (!d) return true;
    if (d.snooze_until) return d.snooze_until <= now;
    return d.last_message_id !== t.lastMessageId;
  };

  return c.json<EmailResponse>({ ...data, needsReply: data.needsReply.filter(visible), waitingOn: data.waitingOn.filter(visible) });
});

email.post("/:threadId/dismiss", async (c) => {
  const { lastMessageId, snoozeUntil } = await c.req.json<{ lastMessageId: string; snoozeUntil?: number }>();
  await c.env.DB.prepare(
    "INSERT INTO email_dismissed (thread_id, last_message_id, snooze_until) VALUES (?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET last_message_id = excluded.last_message_id, snooze_until = excluded.snooze_until",
  )
    .bind(c.req.param("threadId"), lastMessageId, snoozeUntil ?? null)
    .run();
  return c.json({ ok: true });
});

email.delete("/:threadId/dismiss", async (c) => {
  await c.env.DB.prepare("DELETE FROM email_dismissed WHERE thread_id = ?").bind(c.req.param("threadId")).run();
  return c.json({ ok: true });
});

export default email;
