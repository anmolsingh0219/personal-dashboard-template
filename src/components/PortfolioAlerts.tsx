import type { LucideIcon } from "lucide-react";
import { ArrowLeftRight, BellRing, CheckCheck, ExternalLink, StickyNote, TrendingDown, TrendingUp } from "lucide-react";
import type { PortfolioAction, PortfolioEvent } from "../../shared/types";
import { api } from "../lib/api";
import { openChart } from "../lib/chartStore";
import { keys, useAction, usePortfolioEvents, useStocks } from "../lib/queries";
import { ago } from "../lib/time";
import { Card, Empty, ErrorNote, Loading } from "./ui";

// Trades and rebalances in a portfolio the owner follows or copies (e.g. on Autopilot, or a
// newsletter's model portfolio), read from its emails by the scheduled refresh (step 6 of
// scripts/refresh-brief.md). Each alert says whether you already hold the symbol, so it's
// clear what to do to keep up.

const ACTIONS: Record<PortfolioAction, { label: string; icon: LucideIcon; tone: string }> = {
  buy: { label: "Buy", icon: TrendingUp, tone: "text-good" },
  sell: { label: "Sell", icon: TrendingDown, tone: "text-bad" },
  rebalance: { label: "Rebalance", icon: ArrowLeftRight, tone: "text-accent" },
  note: { label: "Note", icon: StickyNote, tone: "text-ink-2" },
};

const markSeen = () => api.post("/portfolio/events/seen", {});

export function PortfolioAlerts({ now }: { now: number }) {
  const events = usePortfolioEvents();
  const portfolios = useStocks().data?.portfolios;
  const holdings = portfolios ? Object.values(portfolios).flatMap((p) => p.holdings) : [];
  const seen = useAction(markSeen, [keys.portfolioEvents]);
  const items = events.data ?? [];
  const unread = items.filter((e) => !e.seen).length;
  const held = new Map(holdings.map((h) => [h.symbol, h.shares]));

  return (
    <Card
      id="alerts"
      title="Portfolio alerts"
      icon={BellRing}
      count={unread}
      fill
      className="xl:flex-1"
      actions={
        unread > 0 && (
          <button className="icon-btn" onClick={() => seen.mutate(undefined)} title="Mark all as read" aria-label="Mark all as read">
            <CheckCheck className="size-4" />
          </button>
        )
      }
    >
      {events.isPending ? (
        <Loading rows={2} />
      ) : events.error ? (
        <ErrorNote error={events.error} />
      ) : items.length === 0 ? (
        <Empty>
          No trades yet. Each scheduled refresh looks for trade and rebalance emails from the portfolio you follow (set up in step 6 of
          scripts/refresh-brief.md), so make sure those emails reach the inbox Claude reads.
        </Empty>
      ) : (
        <ul className="-mx-2 divide-y divide-line/60">
          {items.map((e) => (
            <AlertRow key={e.id} e={e} now={now} held={e.symbol ? held.get(e.symbol) : undefined} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AlertRow({ e, now, held }: { e: PortfolioEvent; now: number; held: number | undefined }) {
  const a = ACTIONS[e.action];
  const Icon = a.icon;
  // What the alert means for the copy: a buy you don't hold yet, or a sell of something you do.
  const hint = e.action === "buy" && held === undefined ? "not in yours" : e.action === "sell" && held !== undefined ? `you hold ${held} sh` : null;

  return (
    <li className="flex items-start gap-2.5 px-2 py-2">
      <span className={`mt-0.5 inline-flex w-[5.5rem] shrink-0 items-center gap-1 text-xs font-medium ${a.tone}`}>
        <Icon className="size-3.5" aria-hidden />
        {a.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
          {e.symbol && (
            <button className="font-medium text-ink hover:text-accent hover:underline" onClick={() => openChart(e.symbol!, e.symbol!)} title={`Open ${e.symbol} chart`}>
              {e.symbol}
            </button>
          )}
          {hint && <span className="chip text-warn">{hint}</span>}
          {!e.seen && <span className="size-1.5 rounded-full bg-accent" aria-label="new" />}
        </p>
        {e.detail && <p className="text-xs text-ink-2">{e.detail}</p>}
        <p className="text-[11px] text-muted">
          {e.portfolio} · {ago(e.occurredAt, now)} ago
        </p>
      </div>
      {e.url && (
        <a href={e.url} target="_blank" rel="noreferrer" className="icon-btn size-7 shrink-0" title="Open the email" aria-label="Open the email">
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </li>
  );
}
