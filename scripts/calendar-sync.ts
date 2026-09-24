// Two-step sync of planner blocks into Google Calendar, run by the scheduled Claude task
// (which does the actual calendar writes through its Calendar connector):
//
//   node scripts/calendar-sync.ts plan              # prints what to create / update / delete
//   node scripts/calendar-sync.ts ack <result.json> # records what was done
//
// Add --local to use the local dev database.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { d1, target } from "./d1.ts";

const HOUR = 3_600_000;
const HORIZON = 14 * 24 * HOUR;
const BLOCK_ID = /^[0-9a-f-]{36}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{5,1024}$/;

interface BlockRow {
  id: string;
  title: string;
  start_at: number;
  end_at: number;
  gcal_event_id: string | null;
  updated_at: number;
}

function plan() {
  const now = Date.now();
  const [settings, blocks, tombstones] = d1(
    `SELECT value FROM settings WHERE key = 'mirrorCalendar';
     SELECT id, title, start_at, end_at, gcal_event_id, updated_at FROM blocks
       WHERE end_at > ${now - 12 * HOUR} AND start_at < ${now + HORIZON}
         AND (gcal_event_id IS NULL OR synced_at IS NULL OR updated_at > synced_at)
       ORDER BY start_at;
     SELECT block_id, gcal_event_id FROM calendar_tombstones;`,
  ) as [{ value: string }[], BlockRow[], { block_id: string; gcal_event_id: string }[]];

  const enabled = settings[0]?.value !== "0";
  const times = (b: BlockRow) => ({ summary: b.title, startTime: new Date(b.start_at).toISOString(), endTime: new Date(b.end_at).toISOString() });
  const out = {
    enabled,
    create: enabled ? blocks.filter((b) => !b.gcal_event_id).map((b) => ({ blockId: b.id, version: b.updated_at, ...times(b) })) : [],
    update: enabled ? blocks.filter((b) => b.gcal_event_id).map((b) => ({ blockId: b.id, version: b.updated_at, eventId: b.gcal_event_id, ...times(b) })) : [],
    // Deletions always go through, even if mirroring was turned off since.
    delete: tombstones.map((t) => ({ blockId: t.block_id, eventId: t.gcal_event_id })),
  };
  console.log(JSON.stringify(out, null, 2));
}

interface AckFile {
  created?: { blockId: string; eventId: string; version: number }[];
  updated?: { blockId: string; version: number }[];
  deleted?: string[];
}

function ack(file: string) {
  const data = JSON.parse(readFileSync(resolve(file), "utf8")) as AckFile;
  const now = Date.now();
  const bad = (what: string) => {
    throw new Error(`Invalid ${what} in ${file}`);
  };
  const version = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : bad("version"));
  const block = (id: unknown) => (typeof id === "string" && BLOCK_ID.test(id) ? id : bad("blockId"));

  // Ids are validated against strict patterns above, so interpolating them is safe.
  const statements: string[] = [];
  for (const c of data.created ?? []) {
    const id = block(c.blockId);
    const eventId = typeof c.eventId === "string" && EVENT_ID.test(c.eventId) ? c.eventId : bad("eventId");
    statements.push(`UPDATE blocks SET gcal_event_id = '${eventId}', synced_at = ${version(c.version)} WHERE id = '${id}' AND gcal_event_id IS NULL`);
    // If the block was deleted while the event was being created, remove the event next run.
    statements.push(
      `INSERT OR IGNORE INTO calendar_tombstones (block_id, gcal_event_id, deleted_at) SELECT '${id}', '${eventId}', ${now} WHERE NOT EXISTS (SELECT 1 FROM blocks WHERE id = '${id}')`,
    );
  }
  for (const u of data.updated ?? []) statements.push(`UPDATE blocks SET synced_at = ${version(u.version)} WHERE id = '${block(u.blockId)}'`);
  for (const d of data.deleted ?? []) statements.push(`DELETE FROM calendar_tombstones WHERE block_id = '${block(d)}'`);

  if (statements.length) d1(statements.join(";\n"));
  console.log(`Calendar sync recorded (${target}): ${data.created?.length ?? 0} created, ${data.updated?.length ?? 0} updated, ${data.deleted?.length ?? 0} deleted.`);
}

const [command, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
try {
  if (command === "plan") plan();
  else if (command === "ack" && file) ack(file);
  else {
    console.error("Usage: node scripts/calendar-sync.ts plan | ack <result.json> [--local]");
    process.exit(2);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
