// Deadline alerts: tasks and job-application steps due today (sent at 8 AM) or tomorrow
// (sent at 7 PM) in the owner's time zone (HOME_TZ in config.ts). Tasks only have a due
// date, so these are day-level nudges.

import { HOME_TZ } from "./config.ts";

export const ALERT_TZ = HOME_TZ;
const MORNING_HOUR = 8;
const EVENING_HOUR = 19;
/** More than this many deadlines are summed up in one notification instead of one each. */
const MAX_SEPARATE = 3;

export interface Deadline {
  kind: "task" | "job";
  id: string;
  /** What's due, e.g. the task title or "Jane Street: Complete HackerRank". */
  title: string;
}

export interface DeadlineMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

function localParts(t: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The alert due in the hour containing `now`, if any: which deadlines, and the day they fall on. */
export function alertWindow(now: number, tz = ALERT_TZ): { when: "today" | "tomorrow"; day: string } | null {
  const { day, hour } = localParts(now, tz);
  if (hour === MORNING_HOUR) return { when: "today", day };
  if (hour === EVENING_HOUR) return { when: "tomorrow", day: nextDay(day) };
  return null;
}

export function deadlineMessages(items: Deadline[], when: "today" | "tomorrow", day: string): DeadlineMessage[] {
  if (items.length === 0) return [];
  if (items.length > MAX_SEPARATE) {
    const shown = items.slice(0, MAX_SEPARATE).map((i) => i.title);
    return [
      {
        title: `${items.length} deadlines ${when}`,
        body: `${shown.join(" · ")} · and ${items.length - MAX_SEPARATE} more`,
        url: "/#tasks",
        tag: `deadlines:${day}`,
      },
    ];
  }
  return items.map((i) => ({
    title: i.kind === "job" ? `Application step due ${when}` : `Due ${when}`,
    body: i.title,
    url: i.kind === "job" ? "/#jobs" : "/#tasks",
    // Same tag for the evening and morning alert, so the morning one replaces last night's.
    tag: `deadline:${i.kind}:${i.id}:${day}`,
  }));
}
