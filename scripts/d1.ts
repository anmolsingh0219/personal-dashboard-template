// Runs SQL against the dashboard's D1 database through this machine's `wrangler login`.
// Scripts target production unless run with --local.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const target = process.argv.includes("--local") ? "local" : "remote";

/** Returns the result rows of each statement in `sql`. Arguments go straight to wrangler, never through a shell. */
export function d1<T = Record<string, unknown>>(sql: string): T[][] {
  try {
    const out = execFileSync("npx", ["wrangler", "d1", "execute", "dashboard", `--${target}`, "--json", "--command", sql], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return (JSON.parse(out) as { results: T[] }[]).map((r) => r.results);
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`D1 query failed: ${(err.stderr || err.stdout || err.message).trim().slice(0, 600)}`);
  }
}

/** Escape a value for a single-quoted SQLite string literal. */
export const sqlString = (s: string) => `'${s.replaceAll("'", "''")}'`;
