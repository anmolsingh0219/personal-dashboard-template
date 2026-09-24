import { Hono } from "hono";
import type { PortfolioEvent } from "../../shared/types";
import type { AppEnv } from "../env";

interface EventRow {
  id: string;
  occurred_at: number;
  portfolio: string;
  action: PortfolioEvent["action"];
  symbol: string | null;
  detail: string | null;
  source: PortfolioEvent["source"];
  url: string | null;
  seen: number;
}

const portfolio = new Hono<AppEnv>();

portfolio.get("/events", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM portfolio_events ORDER BY occurred_at DESC LIMIT 60").all<EventRow>();
  return c.json<PortfolioEvent[]>(
    results.map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at,
      portfolio: r.portfolio,
      action: r.action,
      symbol: r.symbol,
      detail: r.detail,
      source: r.source,
      url: r.url,
      seen: Boolean(r.seen),
    })),
  );
});

portfolio.post("/events/seen", async (c) => {
  await c.env.DB.prepare("UPDATE portfolio_events SET seen = 1 WHERE seen = 0").run();
  return c.json({ ok: true });
});

export default portfolio;
