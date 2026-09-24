export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar-day arithmetic (DST-safe, unlike adding 24h). */
export function addDays(t: number, n: number) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function ymd(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export const atMinute = (day: number, minute: number) => {
  const d = new Date(day);
  d.setHours(0, minute, 0, 0);
  return d.getTime();
};

export const minuteOfDay = (t: number) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};

export function roundUp(t: number, step = 15 * MIN) {
  return Math.ceil(t / step) * step;
}

export const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function fmtDuration(ms: number) {
  const mins = Math.max(0, Math.round(ms / MIN));
  if (mins === 0 && ms > 0) return "<1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function ago(ts: number, now: number) {
  const diff = Math.max(0, now - ts);
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MIN))}m`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h`;
  return `${Math.round(diff / DAY)}d`;
}

/** Whole calendar days from today to the given YYYY-MM-DD (negative = past). */
export function daysUntil(date: string, now: number) {
  return Math.round((parseYmd(date) - startOfDay(now)) / DAY);
}

export function relDay(date: string, now: number) {
  const n = daysUntil(date, now);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n < 0) return `${-n}d overdue`;
  if (n < 7) return new Date(parseYmd(date)).toLocaleDateString([], { weekday: "short" });
  return new Date(parseYmd(date)).toLocaleDateString([], { month: "short", day: "numeric" });
}
