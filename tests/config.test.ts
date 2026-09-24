import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOME_TZ, MARKET_TILES, PORTFOLIO_IDS, PORTFOLIOS } from "../shared/config";

// Guards for hand edits to shared/config.ts and wrangler.jsonc.

const wrangler = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1"),
) as { triggers: { crons: string[] } };

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

describe("config", () => {
  it("schedules a snapshot cron for every portfolio, plus the hourly alert check", () => {
    const crons = wrangler.triggers.crons;
    for (const p of PORTFOLIO_IDS) expect(crons, `add "${PORTFOLIOS[p].snapshotCron}" (${p}) to wrangler.jsonc`).toContain(PORTFOLIOS[p].snapshotCron);
    expect(crons).toContain("5 * * * *");
    // The Workers free plan allows 5 cron triggers per account.
    expect(crons.length).toBeLessThanOrEqual(5);
  });

  it("has valid time zones, currencies and sessions", () => {
    expect(validZone(HOME_TZ)).toBe(true);
    for (const p of PORTFOLIO_IDS) {
      const c = PORTFOLIOS[p];
      expect(validZone(c.tz), `${p}.tz`).toBe(true);
      expect(() => new Intl.NumberFormat(c.locale, { style: "currency", currency: c.currency })).not.toThrow();
      expect(c.open, `${p}.open`).toBeLessThan(c.close);
      for (const s of c.suffixes as readonly string[]) expect(s, `${p} suffixes are upper case and start with "."`).toMatch(/^\.[A-Z]+$/);
    }
  });

  it("gives at most one portfolio no suffix, and never shares a suffix", () => {
    const bare = PORTFOLIO_IDS.filter((p) => (PORTFOLIOS[p].suffixes as readonly string[]).length === 0);
    expect(bare.length).toBeLessThanOrEqual(1);
    const all = PORTFOLIO_IDS.flatMap((p) => PORTFOLIOS[p].suffixes as readonly string[]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("lists market tiles", () => {
    expect(MARKET_TILES.length).toBeGreaterThan(0);
    expect(new Set(MARKET_TILES.map((t) => t.symbol)).size).toBe(MARKET_TILES.length);
  });
});
