// Regular trading sessions of the configured portfolios, used to pick which one to show by
// default. Exchange holidays aren't modeled; on a holiday the panel still switches by the clock.

import { PORTFOLIO_IDS, PORTFOLIOS, type PortfolioConfig, type PortfolioId } from "./config.ts";

export type { PortfolioId };

/** A trading session: a configured portfolio's id, or the session itself. */
export type Session = PortfolioId | Pick<PortfolioConfig, "tz" | "open" | "close" | "tzLabel" | "exchange">;
const sessionOf = (p: Session) => (typeof p === "string" ? PORTFOLIOS[p] : p);

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Wall-clock parts of an instant in a time zone. */
function zoned(t: number, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

/** Offset of `tz` from UTC at instant `t`, in ms. */
function tzOffset(t: number, tz: string) {
  const z = zoned(t, tz);
  return Date.UTC(z.y, z.m - 1, z.d, Math.floor(z.minutes / 60), z.minutes % 60) - Math.floor(t / 60_000) * 60_000;
}

/** The instant at a given wall-clock minute on the zoned calendar day containing `t`. */
function atMinute(t: number, tz: string, minute: number) {
  const z = zoned(t, tz);
  const wall = Date.UTC(z.y, z.m - 1, z.d, Math.floor(minute / 60), minute % 60);
  // Two passes so the offset is taken at the target instant (correct across DST changes).
  return wall - tzOffset(wall - tzOffset(wall, tz), tz);
}

const isWeekday = (t: number, tz: string) => {
  const w = zoned(t, tz).weekday;
  return w >= 1 && w <= 5;
};

export function isOpen(p: Session, now: number) {
  const s = sessionOf(p);
  const z = zoned(now, s.tz);
  return isWeekday(now, s.tz) && z.minutes >= s.open && z.minutes < s.close;
}

/** Most recent session close at or before `now`. */
export function lastClose(p: Session, now: number) {
  const s = sessionOf(p);
  for (let i = 0; i < 8; i++) {
    const day = now - i * DAY;
    if (!isWeekday(day, s.tz)) continue;
    const close = atMinute(day, s.tz, s.close);
    if (close <= now) return close;
  }
  return 0;
}

/** Next session open after `now`. */
export function nextOpen(p: Session, now: number) {
  const s = sessionOf(p);
  for (let i = 0; i < 8; i++) {
    const day = now + i * DAY;
    if (!isWeekday(day, s.tz)) continue;
    const open = atMinute(day, s.tz, s.open);
    if (open > now) return open;
  }
  return now;
}

/** Live market if one is open; otherwise the one that closed most recently. */
export function defaultPortfolio(now: number): PortfolioId {
  const open = PORTFOLIO_IDS.find((p) => isOpen(p, now));
  if (open) return open;
  return PORTFOLIO_IDS.reduce((a, b) => (lastClose(b, now) > lastClose(a, now) ? b : a));
}

export function marketStatus(p: Session, now: number): { open: boolean; label: string } {
  const s = sessionOf(p);
  const fmt = (t: number, withDay: boolean) =>
    new Date(t).toLocaleString("en-US", { timeZone: s.tz, hour: "numeric", minute: "2-digit", ...(withDay ? { weekday: "short" } : {}) });
  if (isOpen(p, now)) return { open: true, label: `${s.exchange} open · closes ${fmt(atMinute(now, s.tz, s.close), false)} ${s.tzLabel}` };
  const next = nextOpen(p, now);
  const sameDay = zoned(next, s.tz).d === zoned(now, s.tz).d;
  return { open: false, label: `${s.exchange} closed · opens ${fmt(next, !sameDay)} ${s.tzLabel}` };
}

const suffixesOf = (p: PortfolioId): readonly string[] => PORTFOLIOS[p].suffixes;

/** The portfolio a ticker belongs to, by its exchange suffix (".NS" → India); bare tickers go to the suffix-less market. */
export function portfolioOf(symbol: string): PortfolioId {
  const upper = symbol.toUpperCase();
  return PORTFOLIO_IDS.find((p) => suffixesOf(p).some((x) => upper.endsWith(x))) ?? PORTFOLIO_IDS.find((p) => suffixesOf(p).length === 0) ?? PORTFOLIO_IDS[0];
}

/** "RELIANCE.NS" → "RELIANCE": tickers are shown without their exchange suffix. */
export function displaySymbol(symbol: string) {
  const x = suffixesOf(portfolioOf(symbol)).find((s) => symbol.toUpperCase().endsWith(s));
  return x ? symbol.slice(0, -x.length) : symbol;
}

/** Adds the portfolio's exchange suffix to a bare ticker typed into it ("NTPC" → "NTPC.NS"). */
export function withSuffix(symbol: string, p: PortfolioId) {
  const own = suffixesOf(p);
  return own.length && !own.some((x) => symbol.endsWith(x)) ? symbol + own[0] : symbol;
}
