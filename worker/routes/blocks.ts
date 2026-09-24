import { Hono } from "hono";
import type { Block, NewBlock } from "../../shared/types";
import { HttpError, newId, type AppEnv, type Bindings } from "../env";
import { getGoogleSession, gfetch, SCOPES, type GoogleSession } from "../lib/google";
import { getSettings, invalidate } from "../lib/store";

// Day-planner time blocks, stored in D1 and copied to Google Calendar when the
// "mirror to calendar" setting is on. With a direct Google connection the copy happens
// right away; otherwise the scheduled Claude task syncs them (scripts/calendar-sync.ts)
// using updated_at/synced_at and the calendar_tombstones table.

interface BlockRow {
  id: string;
  title: string;
  start_at: number;
  end_at: number;
  task_key: string | null;
  done: number;
  gcal_event_id: string | null;
}

const toBlock = (r: BlockRow): Block => ({
  id: r.id,
  title: r.title,
  start: r.start_at,
  end: r.end_at,
  taskKey: r.task_key,
  done: Boolean(r.done),
  mirrored: Boolean(r.gcal_event_id),
});

const EVENTS_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

function validate(b: Partial<NewBlock>): asserts b is NewBlock {
  if (!b.title?.trim()) throw new HttpError(400, "Title is required", "bad_request");
  if (!Number.isFinite(b.start) || !Number.isFinite(b.end) || b.end! <= b.start!) throw new HttpError(400, "Invalid start/end", "bad_request");
}

/** A direct Google session that may write events, if the user has one; null means "leave it to the Claude sync". */
async function directCalendar(env: Bindings): Promise<GoogleSession | null> {
  const session = await getGoogleSession(env).catch(() => null);
  return session?.scopes.has(SCOPES.calendarWrite) ? session : null;
}

const eventBody = (id: string, b: { title: string; start: number; end: number }) =>
  JSON.stringify({
    summary: b.title,
    start: { dateTime: new Date(b.start).toISOString() },
    end: { dateTime: new Date(b.end).toISOString() },
    description: "Planned in your dashboard. [dashboard]",
    transparency: "opaque",
    extendedProperties: { private: { dashboardBlockId: id } },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
  });

async function insertBlocks(env: Bindings, blocks: NewBlock[]): Promise<Block[]> {
  const mirror = (await getSettings(env.DB)).mirrorCalendar;
  const session = mirror ? await directCalendar(env) : null;
  const now = Date.now();
  const rows: (BlockRow & { synced_at: number | null })[] = [];
  for (const b of blocks) {
    validate(b);
    const id = newId();
    let gcalId: string | null = null;
    if (session) {
      const ev = await gfetch<{ id: string }>(session, EVENTS_API, { method: "POST", body: eventBody(id, b) }).catch(() => null);
      gcalId = ev?.id ?? null;
    }
    rows.push({ id, title: b.title.trim(), start_at: b.start, end_at: b.end, task_key: b.taskKey ?? null, done: 0, gcal_event_id: gcalId, synced_at: gcalId ? now : null });
  }
  await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(
        "INSERT INTO blocks (id, title, start_at, end_at, task_key, done, gcal_event_id, created_at, updated_at, synced_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
      ).bind(r.id, r.title, r.start_at, r.end_at, r.task_key, r.gcal_event_id, now, now, r.synced_at),
    ),
  );
  if (session) await invalidate(env.DB, "calendar:");
  return rows.map(toBlock);
}

const blocks = new Hono<AppEnv>();

blocks.get("/", async (c) => {
  const from = Number(c.req.query("from"));
  const to = Number(c.req.query("to"));
  if (!from || !to) throw new HttpError(400, "from and to (epoch ms) are required", "bad_request");
  const { results } = await c.env.DB.prepare("SELECT * FROM blocks WHERE start_at < ? AND end_at > ? ORDER BY start_at").bind(to, from).all<BlockRow>();
  return c.json(results.map(toBlock));
});

blocks.post("/", async (c) => {
  const body = await c.req.json<NewBlock | { blocks: NewBlock[] }>();
  const list = "blocks" in body ? body.blocks : [body];
  if (list.length > 40) throw new HttpError(400, "Too many blocks at once", "bad_request");
  return c.json(await insertBlocks(c.env, list));
});

blocks.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM blocks WHERE id = ?").bind(id).first<BlockRow>();
  if (!row) throw new HttpError(404, "Block not found", "not_found");
  const body = await c.req.json<Partial<{ title: string; start: number; end: number; done: boolean }>>();

  const next = {
    title: body.title?.trim() || row.title,
    start: body.start ?? row.start_at,
    end: body.end ?? row.end_at,
    done: body.done ?? Boolean(row.done),
  };
  validate(next);
  const moved = next.title !== row.title || next.start !== row.start_at || next.end !== row.end_at;
  const now = Date.now();

  // Only changes that show up on the calendar mark the block for re-sync.
  let syncedNow = false;
  if (moved && row.gcal_event_id) {
    const session = await directCalendar(c.env);
    if (session) syncedNow = await gfetch(session, `${EVENTS_API}/${row.gcal_event_id}`, { method: "PATCH", body: eventBody(id, next) }).then(() => true, () => false);
  }
  await c.env.DB.prepare(
    `UPDATE blocks SET title = ?, start_at = ?, end_at = ?, done = ?,
       updated_at = CASE WHEN ? THEN ? ELSE updated_at END,
       synced_at = CASE WHEN ? THEN ? ELSE synced_at END
     WHERE id = ?`,
  )
    .bind(next.title, next.start, next.end, Number(next.done), Number(moved), now, Number(syncedNow), now, id)
    .run();
  return c.json(toBlock({ ...row, title: next.title, start_at: next.start, end_at: next.end, done: Number(next.done) }));
});

blocks.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT gcal_event_id FROM blocks WHERE id = ?").bind(id).first<{ gcal_event_id: string | null }>();
  await c.env.DB.prepare("DELETE FROM blocks WHERE id = ?").bind(id).run();
  if (row?.gcal_event_id) {
    const session = await directCalendar(c.env);
    const removed = session ? await gfetch(session, `${EVENTS_API}/${row.gcal_event_id}`, { method: "DELETE" }).then(() => true, () => false) : false;
    if (!removed) {
      // Leave a note for the Claude sync to delete the calendar event on its next run.
      await c.env.DB.prepare("INSERT OR REPLACE INTO calendar_tombstones (block_id, gcal_event_id, deleted_at) VALUES (?, ?, ?)").bind(id, row.gcal_event_id, Date.now()).run();
    }
  }
  return c.json({ ok: true });
});

export default blocks;
