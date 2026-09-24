// Saves trade alerts for a portfolio the owner follows (found in its emails) to D1.
//
//   node scripts/push-portfolio.ts .portfolio.json [--local]
//
// Events are keyed by Gmail thread + position, so re-sending the same email is harmless.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePortfolioEvents } from "../shared/portfolio.ts";
import { d1, sqlString, target } from "./d1.ts";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: node scripts/push-portfolio.ts <portfolio.json> [--local]");
  process.exit(2);
}

try {
  const events = parsePortfolioEvents(JSON.parse(readFileSync(resolve(file), "utf8")));
  const q = (v: string | null) => (v === null ? "NULL" : sqlString(v));
  const now = Date.now();
  if (events.length) {
    d1(
      events
        .map(
          (e) =>
            `INSERT OR IGNORE INTO portfolio_events (id, occurred_at, portfolio, action, symbol, detail, source, url, created_at)
             VALUES (${q(e.id)}, ${e.occurredAt}, ${q(e.portfolio)}, ${q(e.action)}, ${q(e.symbol)}, ${q(e.detail)}, ${q(e.source)}, ${q(e.url)}, ${now})`,
        )
        .join(";\n"),
    );
  }
  console.log(`Portfolio alerts (${target}): ${events.length} checked.`);
} catch (e) {
  console.error(`Portfolio alerts rejected: ${(e as Error).message}`);
  process.exit(1);
}
