import type { Settings } from "../../shared/types";

// Small helpers over D1: a TTL cache and typed settings.

export async function cached<T>(db: D1Database, key: string, ttlMs: number, load: () => Promise<T>, bypass = false): Promise<T> {
  const now = Date.now();
  if (!bypass) {
    const row = await db.prepare("SELECT value FROM cache WHERE key = ? AND expires_at > ?").bind(key, now).first<{ value: string }>();
    if (row) return JSON.parse(row.value) as T;
  }
  const value = await load();
  await db
    .prepare("INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at")
    .bind(key, JSON.stringify(value), now + ttlMs)
    .run();
  return value;
}

export async function invalidate(db: D1Database, prefix: string) {
  await db.prepare("DELETE FROM cache WHERE key LIKE ? OR expires_at < ?").bind(`${prefix}%`, Date.now()).run();
}

const DEFAULTS: Settings = {
  mirrorCalendar: true,
  dayStartMin: 7 * 60,
  dayEndMin: 23 * 60,
  defaultEstimateMin: 30,
  emailAliases: "",
  readInterests: "",
};

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const out: Settings = { ...DEFAULTS };
  for (const { key, value } of results) {
    if (!(key in DEFAULTS)) continue;
    const k = key as keyof Settings;
    const def = DEFAULTS[k];
    (out as unknown as Record<string, unknown>)[k] = typeof def === "boolean" ? value === "1" : typeof def === "number" ? Number(value) : value;
  }
  return out;
}

export async function saveSettings(db: D1Database, patch: Partial<Settings>) {
  const stmts = Object.entries(patch)
    .filter(([k]) => k in DEFAULTS)
    .map(([k, v]) =>
      db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v)),
    );
  if (stmts.length) await db.batch(stmts);
}
