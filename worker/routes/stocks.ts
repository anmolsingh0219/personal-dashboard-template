import { Hono } from "hono";
import { PORTFOLIO_IDS, PORTFOLIOS } from "../../shared/config";
import { portfolioOf, withSuffix, type PortfolioId } from "../../shared/marketHours";
import type { Holding, PortfolioView, StocksResponse } from "../../shared/types";
import { HttpError, newId, type AppEnv, type Bindings } from "../env";
import { getQuote } from "../lib/quotes";

// The portfolios in shared/config.ts. A holding's exchange suffix (Yahoo's .NS, .L, …) decides
// which portfolio it's in; each one gets its own totals, currency and daily snapshots.

interface HoldingRow {
  id: string;
  symbol: string;
  shares: number;
  cost_basis: number | null;
  portfolio: PortfolioId;
}

// Each holding costs up to two outbound fetches; the Workers free plan allows 50 per request.
const MAX_HOLDINGS = 20;

async function loadHoldings(env: Bindings, bypass = false): Promise<Holding[]> {
  const { results } = await env.DB.prepare("SELECT id, symbol, shares, cost_basis, portfolio FROM holdings ORDER BY created_at").all<HoldingRow>();
  return Promise.all(
    results.map(async (r) => {
      const q = await getQuote(env, r.symbol, bypass);
      return { id: r.id, symbol: r.symbol, portfolio: r.portfolio, shares: r.shares, costBasis: r.cost_basis, ...q };
    }),
  );
}

function totals(holdings: Holding[]) {
  let value = 0;
  let cost = 0;
  let previousValue = 0;
  for (const h of holdings) {
    const price = h.price ?? h.costBasis ?? 0;
    value += price * h.shares;
    previousValue += (h.previousClose ?? price) * h.shares;
    cost += (h.costBasis ?? price) * h.shares;
  }
  return { value, cost, previousValue, dayChange: value - previousValue };
}

/** Called by the cron triggers after each market closes. */
export async function snapshotPortfolio(env: Bindings, portfolio: PortfolioId) {
  const holdings = (await loadHoldings(env, true)).filter((h) => h.portfolio === portfolio);
  if (holdings.length === 0) return;
  const t = totals(holdings);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: PORTFOLIOS[portfolio].tz }).format(new Date());
  await env.DB.prepare(
    "INSERT INTO portfolio_snapshots (day, portfolio, value, cost) VALUES (?, ?, ?, ?) ON CONFLICT(day, portfolio) DO UPDATE SET value = excluded.value, cost = excluded.cost",
  )
    .bind(day, portfolio, t.value, t.cost)
    .run();
}

const stocks = new Hono<AppEnv>();

stocks.get("/", async (c) => {
  const holdings = await loadHoldings(c.env, c.req.query("refresh") === "1");
  const { results: snapshots } = await c.env.DB.prepare(
    "SELECT day, portfolio, value FROM (SELECT day, portfolio, value FROM portfolio_snapshots ORDER BY day DESC LIMIT 360) ORDER BY day",
  ).all<{ day: string; portfolio: PortfolioId; value: number }>();

  const view = (p: PortfolioId): PortfolioView => {
    const mine = holdings.filter((h) => h.portfolio === p);
    return {
      currency: PORTFOLIOS[p].currency,
      holdings: mine,
      totals: totals(mine),
      history: snapshots.filter((s) => s.portfolio === p).map(({ day, value }) => ({ day, value })),
    };
  };
  return c.json<StocksResponse>({ portfolios: Object.fromEntries(PORTFOLIO_IDS.map((p) => [p, view(p)])) as StocksResponse["portfolios"], quotesAt: Date.now() });
});

function parseHolding(body: { symbol?: string; shares?: number; costBasis?: number | null; portfolio?: string }) {
  let symbol = body.symbol?.trim().toUpperCase() ?? "";
  // A bare ticker added to a non-US portfolio gets that exchange's suffix (NTPC → NTPC.NS).
  if (symbol && body.portfolio && body.portfolio in PORTFOLIOS) symbol = withSuffix(symbol, body.portfolio as PortfolioId);
  const examples = PORTFOLIO_IDS.map((p) => PORTFOLIOS[p].tickerExample).join(" or ");
  if (!symbol || !/^[A-Z0-9.\-^=&]{1,20}$/.test(symbol)) throw new HttpError(400, `Enter a ticker like ${examples}`, "bad_request");
  if (!Number.isFinite(body.shares) || body.shares! <= 0) throw new HttpError(400, "Shares must be a positive number", "bad_request");
  const cost = body.costBasis == null || body.costBasis === 0 ? null : Number(body.costBasis);
  if (cost !== null && !(cost > 0)) throw new HttpError(400, "Cost basis must be positive", "bad_request");
  return { symbol, shares: Number(body.shares), cost, portfolio: portfolioOf(symbol) };
}

stocks.post("/", async (c) => {
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM holdings").first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_HOLDINGS) throw new HttpError(400, `Up to ${MAX_HOLDINGS} holdings`, "bad_request");
  const h = parseHolding(await c.req.json());
  const id = newId();
  await c.env.DB.prepare("INSERT INTO holdings (id, symbol, shares, cost_basis, portfolio, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, h.symbol, h.shares, h.cost, h.portfolio, Date.now())
    .run();
  return c.json({ id });
});

stocks.put("/:id", async (c) => {
  const h = parseHolding(await c.req.json());
  const res = await c.env.DB.prepare("UPDATE holdings SET symbol = ?, shares = ?, cost_basis = ?, portfolio = ? WHERE id = ?")
    .bind(h.symbol, h.shares, h.cost, h.portfolio, c.req.param("id"))
    .run();
  if (!res.meta.changes) throw new HttpError(404, "Holding not found", "not_found");
  return c.json({ ok: true });
});

stocks.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM holdings WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default stocks;
