import type { Bar, ChartRange } from "../../shared/types";
import { HttpError, type Bindings } from "../env";
import { cached } from "./store";

export interface Quote {
  price: number | null;
  previousClose: number | null;
  spark: number[];
}

const EMPTY: Quote = { price: null, previousClose: null, spark: [] };

// Yahoo's chart endpoint needs no key and includes intraday points for the sparkline.
// Finnhub (free key) is the fallback when Yahoo rate-limits.

async function fromYahoo(symbol: string): Promise<Quote | null> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`, {
    headers: { "User-Agent": "Mozilla/5.0 (dashboard)", Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json<{
    chart?: { result?: { meta: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number }; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  }>();
  const r = data.chart?.result?.[0];
  if (!r?.meta.regularMarketPrice) return null;
  const closes = (r.indicators?.quote?.[0]?.close ?? []).filter((v): v is number => typeof v === "number");
  return { price: r.meta.regularMarketPrice, previousClose: r.meta.chartPreviousClose ?? r.meta.previousClose ?? null, spark: closes };
}

async function fromFinnhub(symbol: string, key: string): Promise<Quote | null> {
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`);
  if (!res.ok) return null;
  const q = await res.json<{ c?: number; pc?: number }>();
  return q.c ? { price: q.c, previousClose: q.pc ?? null, spark: [] } : null;
}

export async function getQuote(env: Bindings, symbol: string, bypass = false): Promise<Quote> {
  return cached(
    env.DB,
    `quote:${symbol}`,
    60_000,
    async () => {
      const yahoo = await fromYahoo(symbol).catch(() => null);
      if (yahoo) return yahoo;
      if (env.FINNHUB_API_KEY) return (await fromFinnhub(symbol, env.FINNHUB_API_KEY).catch(() => null)) ?? EMPTY;
      return EMPTY;
    },
    bypass,
  );
}

// Price history for the chart pop-up. "2020" is everything since Jan 1, 2020 (daily bars).
const RANGE_PARAMS: Record<ChartRange, { query: () => string; interval: string; ttl: number }> = {
  // 5 days of 5-minute bars, trimmed to the latest session below (range=1d is empty right after the open).
  "1d": { query: () => "range=5d", interval: "5m", ttl: 60_000 },
  "5d": { query: () => "range=5d", interval: "15m", ttl: 2 * 60_000 },
  "1mo": { query: () => "range=1mo", interval: "60m", ttl: 10 * 60_000 },
  "6mo": { query: () => "range=6mo", interval: "1d", ttl: 30 * 60_000 },
  "1y": { query: () => "range=1y", interval: "1d", ttl: 30 * 60_000 },
  "5y": { query: () => "range=5y", interval: "1wk", ttl: 60 * 60_000 },
  "2020": { query: () => `period1=${Date.UTC(2020, 0, 1) / 1000}&period2=${Math.floor(Date.now() / 1000)}`, interval: "1d", ttl: 60 * 60_000 },
};

export const isIntraday = (range: ChartRange) => ["1d", "5d", "1mo"].includes(range);

export async function getBars(env: Bindings, symbol: string, range: ChartRange): Promise<Bar[]> {
  const p = RANGE_PARAMS[range];
  return cached(env.DB, `bars:${symbol}:${range}`, p.ttl, async () => {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${p.query()}&interval=${p.interval}`, {
      headers: { "User-Agent": "Mozilla/5.0 (dashboard)", Accept: "application/json" },
    });
    if (!res.ok) throw new HttpError(502, `Price history unavailable (${res.status})`);
    const data = await res.json<{
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }[] } }[] };
    }>();
    const r = data.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return [];
    const bars: Bar[] = [];
    r.timestamp.forEach((t, i) => {
      const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
      if (o != null && h != null && l != null && c != null) bars.push({ t, o, h, l, c });
    });
    return range === "1d" ? lastSession(bars) : bars;
  });
}

/**
 * The most recent trading session: bars after the last gap of more than 30 minutes.
 * A session that has barely started (under an hour of bars) also shows the one before it.
 */
export function lastSession(bars: Bar[], minBars = 12): Bar[] {
  let start = bars.length;
  for (let i = bars.length - 1; i > 0; i--) {
    if (bars[i].t - bars[i - 1].t > 30 * 60) {
      start = i;
      if (bars.length - start >= minBars) return bars.slice(start);
    }
  }
  return bars;
}
