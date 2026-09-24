import { addDays, parseYmd, ymd } from "./time";

// "Finish essay ~45m @tomorrow" -> { title: "Finish essay", estimateMin: 45, due: "<tomorrow>" }

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface QuickTask {
  title: string;
  estimateMin: number | null;
  due: string | null;
}

function parseDue(token: string, now: number): string | null {
  const t = token.toLowerCase();
  if (t === "today" || t === "tod") return ymd(now);
  if (t === "tomorrow" || t === "tmr" || t === "tom") return ymd(addDays(now, 1));
  const wd = WEEKDAYS.findIndex((d) => t.startsWith(d));
  if (wd !== -1 && t.length <= 9) {
    const diff = (wd - new Date(now).getDay() + 7) % 7 || 7;
    return ymd(addDays(now, diff));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const md = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) {
    const year = new Date(now).getFullYear();
    const candidate = new Date(year, Number(md[1]) - 1, Number(md[2])).getTime();
    // A date that already passed this year means next year.
    return ymd(candidate < parseYmd(ymd(now)) ? new Date(year + 1, Number(md[1]) - 1, Number(md[2])).getTime() : candidate);
  }
  return null;
}

export function parseQuickTask(input: string, now: number): QuickTask {
  let estimateMin: number | null = null;
  let due: string | null = null;
  const words: string[] = [];

  for (const word of input.trim().split(/\s+/)) {
    const est = word.match(/^~(\d+(?:\.\d+)?)(m|min|h|hr)?$/i);
    if (est) {
      const n = Number(est[1]);
      estimateMin = Math.round(est[2]?.toLowerCase().startsWith("h") ? n * 60 : n);
      continue;
    }
    if (word.startsWith("@") && word.length > 1) {
      const parsed = parseDue(word.slice(1), now);
      if (parsed) {
        due = parsed;
        continue;
      }
    }
    words.push(word);
  }
  return { title: words.join(" "), estimateMin, due };
}
