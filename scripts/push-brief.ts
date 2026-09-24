// Saves the scheduled Claude task's Gmail/Calendar/markets snapshot into D1 for the dashboard.
//
//   node scripts/push-brief.ts .brief.json                # production database
//   node scripts/push-brief.ts .brief.json --local        # local dev database
//   node scripts/push-brief.ts events.json --events-only  # replace only the calendar events
//
// The file is validated and cleaned by parseBrief before anything is written. With
// --events-only the file needs just `events`; email and markets keep their snapshot time.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseBrief } from "../shared/brief.ts";
import { d1, sqlString, target } from "./d1.ts";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: node scripts/push-brief.ts <brief.json> [--local]");
  process.exit(2);
}

try {
  const input = JSON.parse(readFileSync(resolve(file), "utf8")) as Record<string, unknown>;
  if (process.argv.includes("--events-only")) {
    const [rows] = d1<{ data: string; updated_at: number }>("SELECT data, updated_at FROM imports WHERE kind = 'brief'");
    if (!rows?.length) throw new Error("no snapshot yet; push a full brief first");
    const current = JSON.parse(rows[0].data) as Record<string, unknown>;
    const brief = parseBrief({ ...current, events: input.events, eventsAt: Date.now() }, rows[0].updated_at);
    // updated_at stays put, so the Email panel keeps showing when its data was fetched.
    d1(`UPDATE imports SET data = ${sqlString(JSON.stringify(brief))} WHERE kind = 'brief'`);
    console.log(`Calendar updated (${target}): ${brief.events.length} events.`);
    process.exit(0);
  }
  const brief = parseBrief(input, Date.now());
  d1(
    `INSERT INTO imports (kind, data, updated_at) VALUES ('brief', ${sqlString(JSON.stringify(brief))}, ${brief.generatedAt}) ` +
      "ON CONFLICT(kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  );
  const markets = brief.markets ? `, ${brief.markets.rates.length} rates, ${brief.markets.summary.length} market notes` : "";
  console.log(`Brief updated (${target}): ${brief.needsReply.length} need reply, ${brief.waitingOn.length} waiting on, ${brief.events.length} events${markets}.`);
} catch (e) {
  console.error(`Brief rejected: ${(e as Error).message}`);
  process.exit(1);
}
