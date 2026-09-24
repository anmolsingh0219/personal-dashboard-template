import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Landmark } from "lucide-react";
import type { MarketQuote, MarketsResponse, Rate } from "../../shared/types";
import { api } from "../lib/api";
import { openChart } from "../lib/chartStore";
import { useAction, useMarkets } from "../lib/queries";
import { ago, daysUntil, fmtTime, parseYmd } from "../lib/time";
import { Sparkline } from "./Sparkline";
import { Card, ErrorNote, Loading, RefreshButton } from "./ui";

const points = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDate = (ymd: string) => new Date(parseYmd(ymd)).toLocaleDateString([], { month: "short", day: "numeric" });

export function Markets({ now }: { now: number }) {
  const qc = useQueryClient();
  const markets = useMarkets();
  const refresh = useAction(() => api.get<MarketsResponse>("/markets?refresh=1").then((d) => qc.setQueryData(["markets"], d)), []);
  const data = markets.data;

  return (
    <Card id="markets" title="Markets" icon={Landmark} fill className="xl:flex-[1.5]" actions={<RefreshButton onClick={() => refresh.mutate()} busy={markets.isFetching || refresh.isPending} label="Refresh prices" />}>
      {markets.error ? (
        <ErrorNote error={markets.error} />
      ) : !data ? (
        <Loading rows={3} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.quotes.map((q) => (
              <QuoteTile key={q.symbol} q={q} />
            ))}
          </div>
          <p className="-mt-2 text-[11px] text-muted">Tap a market for its chart with events since 2020.</p>

          <section aria-label="Policy rates">
            {data.rates.length > 0 ? (
              <ul className="divide-y divide-line/60">
                {data.rates.map((r) => (
                  <RateRow key={r.name} r={r} now={now} />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">RBI and Fed rates, with their next meeting dates, show up after the next scheduled Claude refresh.</p>
            )}
          </section>

          {data.summary.length > 0 && (
            <section aria-label="What's moving markets">
              <h3 className="mb-1.5 flex items-baseline text-[11px] font-semibold tracking-wide text-muted uppercase">
                What's moving
                {data.briefAt && <span className="ml-auto font-normal tracking-normal normal-case">via Claude · {fmtTime(data.briefAt)}</span>}
              </h3>
              <ul className="space-y-1.5">
                {data.summary.map((n) => (
                  <li key={n.text} className="flex gap-2 text-sm text-ink-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-muted" aria-hidden />
                    <span>
                      {n.text}
                      {n.url && (
                        <a href={n.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex align-middle text-muted hover:text-ink" aria-label="Source">
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.headlines.length > 0 && (
            <section aria-label="Headlines">
              <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Headlines</h3>
              <ul className="-mx-2 max-h-72 overflow-y-auto xl:max-h-none xl:overflow-visible">
                {data.headlines.map((h) => (
                  <li key={h.url}>
                    <a href={h.url} target="_blank" rel="noreferrer" className="block rounded-lg px-2 py-1.5 hover:bg-raised/60">
                      <p className="text-sm leading-snug text-ink">{h.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {h.source}
                        {h.publishedAt && ` · ${ago(h.publishedAt, now)} ago`}
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Card>
  );
}

function QuoteTile({ q }: { q: MarketQuote }) {
  const change = q.price !== null && q.previousClose ? (q.price - q.previousClose) / q.previousClose : null;
  const up = (change ?? 0) >= 0;
  const flat = change !== null && Math.abs(change) < 0.00005; // rounds to 0.00%
  return (
    <button
      className="rounded-xl bg-raised/50 px-3 py-2 text-left transition hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60"
      onClick={() => openChart(q.symbol, q.name)}
      title={`Open ${q.name} chart`}
    >
      <p className="text-[11px] text-muted">{q.name}</p>
      <p className="text-base font-semibold text-ink tabular">
        {q.price === null ? "—" : `${q.currency ?? ""}${points.format(q.price)}`}
        {q.unit && q.price !== null && <span className="ml-0.5 text-[11px] font-normal text-muted">/{q.unit}</span>}
      </p>
      <div className="flex items-center justify-between gap-1">
        <span className={`text-xs tabular ${change === null || flat ? "text-muted" : up ? "text-good" : "text-bad"}`}>
          {change === null ? "—" : flat ? "0.00%" : `${up ? "▲" : "▼"} ${Math.abs(change * 100).toFixed(2)}%`}
        </span>
        <Sparkline values={q.spark} baseline={q.previousClose} up={up} />
      </div>
    </button>
  );
}

function RateRow({ r, now }: { r: Rate; now: number }) {
  const days = r.nextDate ? daysUntil(r.nextDate, now) : null;
  return (
    <li className="flex items-baseline gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-2">
          {r.source ? (
            <a href={r.source} target="_blank" rel="noreferrer" className="hover:text-ink hover:underline">
              {r.name}
            </a>
          ) : (
            r.name
          )}
        </p>
        {r.nextDate && (
          <p className="text-[11px] text-muted">
            {r.nextLabel ?? "Next meeting"} · {shortDate(r.nextDate)}
            {days !== null && days >= 0 && ` (${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days}d`})`}
          </p>
        )}
      </div>
      <p className="text-base font-semibold text-ink tabular" title={r.asOf ? `Set on ${shortDate(r.asOf)}` : undefined}>
        {r.value}
      </p>
    </li>
  );
}
