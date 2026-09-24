import { Hono } from "hono";
import { CHART_RANGES, type ChartRange, type ChartResponse, type Headline, type MarketQuote, type MarketsResponse } from "../../shared/types";
import { MARKET_TILES, NEWS_FEEDS } from "../../shared/config";
import { HttpError, type AppEnv, type Bindings } from "../env";
import { loadBrief } from "../lib/brief";
import { getBars, getQuote, isIntraday } from "../lib/quotes";
import { parseRss } from "../lib/rss";
import { cached } from "../lib/store";

// Live prices (Yahoo), headlines (news RSS), and the policy rates + "what's moving"
// notes that the scheduled Claude task looks up.

// Tiles and feeds are configured in shared/config.ts.
const INSTRUMENTS: Omit<MarketQuote, "price" | "previousClose" | "spark">[] = MARKET_TILES;
const FEEDS = NEWS_FEEDS;
const PER_FEED = 4;
const MAX_HEADLINES = 10;
// IPO grey-market-premium promos dominate some Indian feeds and aren't news.
const NOISE = /\bGMP\b|IPO opens|shares to list/i;

async function headlines(env: Bindings, bypass: boolean): Promise<Headline[]> {
  return cached(
    env.DB,
    "markets:headlines",
    10 * 60_000,
    async () => {
      const lists = await Promise.all(
        FEEDS.map(async (f) => {
          const res = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (dashboard)" } }).catch(() => null);
          if (!res?.ok) return [];
          return parseRss(await res.text(), f.source)
            .filter((h) => !NOISE.test(h.title))
            .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
            .slice(0, PER_FEED);
        }),
      );
      const seen = new Set<string>();
      return lists
        .flat()
        .filter((h) => !seen.has(h.title.toLowerCase()) && seen.add(h.title.toLowerCase()))
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
        .slice(0, MAX_HEADLINES);
    },
    bypass,
  );
}

const markets = new Hono<AppEnv>();

markets.get("/", async (c) => {
  const bypass = c.req.query("refresh") === "1";
  const [quotes, news, brief] = await Promise.all([
    Promise.all(INSTRUMENTS.map(async (i) => ({ ...i, ...(await getQuote(c.env, i.symbol, bypass)) }))),
    headlines(c.env, bypass),
    loadBrief(c.env.DB),
  ]);
  return c.json<MarketsResponse>({
    quotes,
    headlines: news,
    rates: brief?.markets?.rates ?? [],
    summary: brief?.markets?.summary ?? [],
    briefAt: brief?.markets ? brief.generatedAt : null,
    quotesAt: Date.now(),
  });
});

markets.get("/chart", async (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const range = (c.req.query("range") ?? "1y") as ChartRange;
  if (!CHART_RANGES.includes(range)) throw new HttpError(400, "Unknown range", "bad_request");

  // Only the dashboard's own instruments and the owner's holdings can be charted.
  const known = INSTRUMENTS.find((i) => i.symbol === symbol);
  const holding = known ? null : await c.env.DB.prepare("SELECT symbol FROM holdings WHERE symbol = ? LIMIT 1").bind(symbol).first<{ symbol: string }>();
  if (!known && !holding) throw new HttpError(404, "Unknown symbol", "not_found");

  return c.json<ChartResponse>({
    symbol,
    name: known?.name ?? symbol,
    currency: known ? known.currency : "$",
    unit: known?.unit ?? null,
    range,
    intraday: isIntraday(range),
    bars: await getBars(c.env, symbol, range),
  });
});

export default markets;
