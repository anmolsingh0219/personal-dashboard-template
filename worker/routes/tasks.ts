import { Hono } from "hono";
import type { Task, TasksResponse } from "../../shared/types";
import { HttpError, newId, type AppEnv } from "../env";
import { getGoogleSession, gfetch, requireGoogle, SCOPES } from "../lib/google";

// Tasks come from two places: Google Tasks (synced both ways) and dashboard-only tasks
// in D1. New tasks go to Google when it's connected, otherwise they stay local.

interface GTaskList {
  id: string;
  title: string;
}
interface GTask {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status: "needsAction" | "completed";
}
interface LocalTaskRow {
  id: string;
  title: string;
  notes: string | null;
  due: string | null;
  done: number;
}

const TASKS_API = "https://tasks.googleapis.com/tasks/v1";

function parseKey(key: string) {
  const [source, a, b] = key.split(":");
  if (source === "local" && a) return { source: "local" as const, id: a };
  if (source === "google" && a && b) return { source: "google" as const, listId: a, taskId: b };
  throw new HttpError(400, "Bad task key", "bad_request");
}

const tasks = new Hono<AppEnv>();

tasks.get("/", async (c) => {
  const db = c.env.DB;
  const [{ results: local }, { results: meta }] = await Promise.all([
    db.prepare("SELECT id, title, notes, due, done FROM tasks WHERE done = 0 ORDER BY created_at").all<LocalTaskRow>(),
    db.prepare("SELECT task_key, estimate_min FROM task_meta").all<{ task_key: string; estimate_min: number | null }>(),
  ]);
  const estimates = new Map(meta.map((m) => [m.task_key, m.estimate_min]));

  const out: Task[] = local.map((t) => ({
    key: `local:${t.id}`,
    source: "local",
    list: null,
    title: t.title,
    notes: t.notes,
    due: t.due,
    done: Boolean(t.done),
    estimateMin: estimates.get(`local:${t.id}`) ?? null,
  }));

  let googleConnected = false;
  let googleError: string | null = null;
  const session = await getGoogleSession(c.env).catch((e: Error) => ((googleError = e.message), null));
  if (session?.scopes.has(SCOPES.tasks)) {
    googleConnected = true;
    try {
      const lists = await gfetch<{ items?: GTaskList[] }>(session, `${TASKS_API}/users/@me/lists?maxResults=20`);
      const perList = await Promise.all(
        (lists.items ?? []).map(async (list) => {
          const res = await gfetch<{ items?: GTask[] }>(session, `${TASKS_API}/lists/${list.id}/tasks?showCompleted=false&showHidden=false&maxResults=100`);
          return (res.items ?? [])
            .filter((t) => t.title?.trim())
            .map<Task>((t) => {
              const key = `google:${list.id}:${t.id}`;
              return {
                key,
                source: "google",
                list: list.title,
                title: t.title!,
                notes: t.notes ?? null,
                due: t.due ? t.due.slice(0, 10) : null,
                done: t.status === "completed",
                estimateMin: estimates.get(key) ?? null,
              };
            });
        }),
      );
      out.push(...perList.flat());
    } catch (e) {
      googleError = (e as Error).message;
    }
  }

  // Overdue and due-soon first, undated last.
  out.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  return c.json<TasksResponse>({ googleConnected, googleError, tasks: out });
});

tasks.post("/", async (c) => {
  const body = await c.req.json<{ title: string; due?: string | null; notes?: string | null; estimateMin?: number | null; target?: "google" | "local" }>();
  const title = body.title?.trim();
  if (!title) throw new HttpError(400, "Title is required", "bad_request");

  const session = await getGoogleSession(c.env).catch(() => null);
  const useGoogle = body.target !== "local" && session?.scopes.has(SCOPES.tasks);
  let key: string;

  if (useGoogle) {
    const created = await gfetch<GTask>(session!, `${TASKS_API}/lists/@default/tasks`, {
      method: "POST",
      body: JSON.stringify({ title, notes: body.notes ?? undefined, due: body.due ? `${body.due}T00:00:00.000Z` : undefined }),
    });
    // Resolve the real id of @default so keys are stable.
    const list = await gfetch<GTaskList>(session!, `${TASKS_API}/users/@me/lists/@default`);
    key = `google:${list.id}:${created.id}`;
  } else {
    const id = newId();
    await c.env.DB.prepare("INSERT INTO tasks (id, title, notes, due, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, title, body.notes ?? null, body.due ?? null, Date.now())
      .run();
    key = `local:${id}`;
  }

  if (body.estimateMin) await setEstimate(c.env.DB, key, body.estimateMin);
  return c.json({ key });
});

tasks.patch("/:key", async (c) => {
  const key = c.req.param("key");
  const parsed = parseKey(key);
  const body = await c.req.json<{ done?: boolean; title?: string; due?: string | null; estimateMin?: number | null }>();

  if (body.estimateMin !== undefined) await setEstimate(c.env.DB, key, body.estimateMin);

  const fields = body.done !== undefined || body.title !== undefined || body.due !== undefined;
  if (fields && parsed.source === "local") {
    const row = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(parsed.id).first();
    if (!row) throw new HttpError(404, "Task not found", "not_found");
    await c.env.DB.prepare(
      `UPDATE tasks SET
         title = COALESCE(?, title),
         due = CASE WHEN ? THEN ? ELSE due END,
         done = COALESCE(?, done),
         completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END
       WHERE id = ?`,
    )
      .bind(body.title ?? null, body.due !== undefined ? 1 : 0, body.due ?? null, body.done === undefined ? null : Number(body.done), Number(body.done ?? 0), Date.now(), parsed.id)
      .run();
  } else if (fields && parsed.source === "google") {
    const session = await requireGoogle(c.env, SCOPES.tasks);
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.due !== undefined) patch.due = body.due ? `${body.due}T00:00:00.000Z` : null;
    if (body.done !== undefined) patch.status = body.done ? "completed" : "needsAction";
    await gfetch(session, `${TASKS_API}/lists/${parsed.listId}/tasks/${parsed.taskId}`, { method: "PATCH", body: JSON.stringify(patch) });
  }
  return c.json({ ok: true });
});

tasks.delete("/:key", async (c) => {
  const key = c.req.param("key");
  const parsed = parseKey(key);
  if (parsed.source === "local") {
    await c.env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(parsed.id).run();
  } else {
    const session = await requireGoogle(c.env, SCOPES.tasks);
    await gfetch(session, `${TASKS_API}/lists/${parsed.listId}/tasks/${parsed.taskId}`, { method: "DELETE" });
  }
  await c.env.DB.prepare("DELETE FROM task_meta WHERE task_key = ?").bind(key).run();
  return c.json({ ok: true });
});

async function setEstimate(db: D1Database, key: string, minutes: number | null) {
  await db
    .prepare("INSERT INTO task_meta (task_key, estimate_min) VALUES (?, ?) ON CONFLICT(task_key) DO UPDATE SET estimate_min = excluded.estimate_min")
    .bind(key, minutes)
    .run();
}

export default tasks;
