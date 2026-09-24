import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useState, type PointerEvent } from "react";
import { PORTFOLIO_IDS, PORTFOLIOS } from "../../shared/config";
import { defaultPortfolio, displaySymbol, marketStatus, type PortfolioId } from "../../shared/marketHours";
import type { Holding, PortfolioView } from "../../shared/types";
import { api } from "../lib/api";
import { openChart } from "../lib/chartStore";
import { useDashEvent } from "../lib/events";
import { keys, useAction, useStocks } from "../lib/queries";
import { parseYmd } from "../lib/time";
import { Sparkline } from "./Sparkline";
import { Card, Empty, ErrorNote, Loading, RefreshButton } from "./ui";

// The portfolios in shared/config.ts. The panel shows whichever market is open, else the one
// that closed most recently; the switch overrides that until the page reloads.

interface Money {
  full: (n: number) => string;
  whole: (n: number) => string;
}
const money = (p: PortfolioId): Money => {
  const { currency, locale } = PORTFOLIOS[p];
  const full = new Intl.NumberFormat(locale, { style: "currency", currency });
  const whole = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  return { full: (n) => full.format(n), whole: (n) => whole.format(n) };
};
const pct = (n: number) => `${Math.abs(n * 100).toFixed(2)}%`;
/** "$" or "₹" for a portfolio's currency. */
const currencySymbol = (p: PortfolioId) =>
  new Intl.NumberFormat(PORTFOLIOS[p].locale, { style: "currency", currency: PORTFOLIOS[p].currency }).formatToParts(0).find((x) => x.type === "currency")?.value ?? "";

type HoldingInput = { symbol: string; shares: number; costBasis: number | null };
const holdingApi = {
  create: (h: HoldingInput & { portfolio: PortfolioId }) => api.post("/stocks", h),
  update: ({ id, ...h }: HoldingInput & { id: string; portfolio: PortfolioId }) => api.put(`/stocks/${id}`, h),
  remove: (id: string) => api.del(`/stocks/${id}`),
};

export function Stocks({ now }: { now: number }) {
  const qc = useQueryClient();
  const stocks = useStocks();
  const [manual, setManual] = useState<PortfolioId | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const create = useAction(holdingApi.create, [keys.stocks]);
  const update = useAction(holdingApi.update, [keys.stocks]);
  const remove = useAction(holdingApi.remove, [keys.stocks]);
  const refresh = useAction(() => api.get("/stocks?refresh=1").then((d) => qc.setQueryData(keys.stocks, d)), []);
  useDashEvent("dash:add-holding", () => setAdding(true));

  const auto = defaultPortfolio(now);
  const active = manual ?? auto;
  const view = stocks.data?.portfolios[active];
  const status = marketStatus(active, now);
  const m = money(active);

  function pick(p: PortfolioId) {
    setManual(p === auto ? null : p);
    setEditing(null);
    setAdding(false);
  }

  return (
    <Card
      id="stocks"
      title="Portfolio"
      icon={Wallet}
      fill
      className="xl:flex-1"
      actions={
        <>
          {PORTFOLIO_IDS.length > 1 && (
            <div className="mr-1 flex rounded-lg bg-raised p-0.5 text-xs" role="radiogroup" aria-label="Portfolio">
              {PORTFOLIO_IDS.map((p) => {
                const s = marketStatus(p, now);
                return (
                  <button
                    key={p}
                    role="radio"
                    aria-checked={active === p}
                    onClick={() => pick(p)}
                    title={s.label}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium transition ${active === p ? "bg-card text-ink shadow" : "text-muted hover:text-ink"}`}
                  >
                    {s.open && <span className="size-1.5 rounded-full bg-good" />}
                    {PORTFOLIOS[p].label}
                    {s.open && <span className="sr-only">(market open)</span>}
                  </button>
                );
              })}
            </div>
          )}
          <RefreshButton onClick={() => refresh.mutate()} busy={stocks.isFetching || refresh.isPending} label="Refresh quotes" />
          <button className="icon-btn" onClick={() => setAdding(!adding)} title="Add holding" aria-label="Add holding">
            <Plus className="size-4" />
          </button>
        </>
      }
    >
      <p className="-mt-0.5 mb-2 text-[11px] text-muted">
        <span className={status.open ? "text-good" : ""}>{status.label}</span>
        {manual && (
          <>
            {" · "}
            <button className="underline decoration-dotted hover:text-ink" onClick={() => setManual(null)}>
              back to auto
            </button>
          </>
        )}
      </p>

      {adding && (
        <HoldingForm
          portfolio={active}
          onCancel={() => setAdding(false)}
          onSubmit={(h) => {
            create.mutate({ ...h, portfolio: active });
            setAdding(false);
          }}
        />
      )}

      {stocks.isPending ? (
        <Loading />
      ) : stocks.error ? (
        <ErrorNote error={stocks.error} />
      ) : !view || view.holdings.length === 0 ? (
        <Empty>
          No {PORTFOLIOS[active].adjective} holdings yet.{" "}
          <button className="text-accent hover:underline" onClick={() => setAdding(true)}>
            Add one
          </button>
        </Empty>
      ) : (
        <PortfolioBody
          view={view}
          portfolio={active}
          m={m}
          quotesAt={stocks.data.quotesAt}
          editing={editing}
          setEditing={setEditing}
          onUpdate={(id, h) => update.mutate({ id, ...h, portfolio: active })}
          onRemove={(id) => remove.mutate(id)}
        />
      )}
    </Card>
  );
}

function PortfolioBody({
  view,
  portfolio,
  m,
  quotesAt,
  editing,
  setEditing,
  onUpdate,
  onRemove,
}: {
  view: PortfolioView;
  portfolio: PortfolioId;
  m: Money;
  quotesAt: number;
  editing: string | null;
  setEditing: (id: string | null) => void;
  onUpdate: (id: string, h: HoldingInput) => void;
  onRemove: (id: string) => void;
}) {
  const t = view.totals;
  const dayPct = t.previousValue ? t.dayChange / t.previousValue : 0;
  const gain = t.value - t.cost;
  const gainPct = t.cost ? gain / t.cost : 0;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="text-3xl font-semibold tracking-tight text-ink tabular">{m.full(t.value)}</p>
        <div className="pb-1 text-sm">
          <Delta value={t.dayChange} pct={dayPct} suffix="today" m={m} />
        </div>
        {t.cost > 0 && (
          <div className="pb-1 text-sm">
            <Delta value={gain} pct={gainPct} suffix="total" m={m} />
          </div>
        )}
      </div>

      {view.history.length >= 2 ? (
        <HistoryChart points={view.history} m={m} />
      ) : (
        <p className="mb-2 text-xs text-muted">A snapshot is saved after each market close, so a history chart shows up after a couple of trading days.</p>
      )}

      <table className="mt-2 w-full text-sm tabular">
        <thead>
          <tr className="text-left text-[11px] text-muted">
            <th className="py-1 font-medium">Symbol</th>
            <th className="py-1 font-medium">
              <span className="sr-only">Today's trend</span>
            </th>
            <th className="py-1 text-right font-medium">Price</th>
            <th className="py-1 text-right font-medium">Day</th>
            <th className="py-1 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {view.holdings.map((h) =>
            editing === h.id ? (
              <tr key={h.id}>
                <td colSpan={5} className="py-1">
                  <HoldingForm
                    portfolio={portfolio}
                    initial={h}
                    onCancel={() => setEditing(null)}
                    onDelete={() => {
                      onRemove(h.id);
                      setEditing(null);
                    }}
                    onSubmit={(v) => {
                      onUpdate(h.id, v);
                      setEditing(null);
                    }}
                  />
                </td>
              </tr>
            ) : (
              <HoldingRow key={h.id} h={h} m={m} onClick={() => setEditing(h.id)} />
            ),
          )}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">Quotes may be delayed · updated {new Date(quotesAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
    </>
  );
}

function Delta({ value, pct: p, suffix, m }: { value: number; pct: number; suffix: string; m: Money }) {
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${up ? "text-good" : "text-bad"}`}>
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular">
        {up ? "+" : "−"}
        {m.full(Math.abs(value))} ({pct(p)})
      </span>
      <span className="text-muted">{suffix}</span>
    </span>
  );
}

function HoldingRow({ h, m, onClick }: { h: Holding; m: Money; onClick: () => void }) {
  const change = h.price !== null && h.previousClose ? (h.price - h.previousClose) / h.previousClose : null;
  const up = (change ?? 0) >= 0;
  const name = displaySymbol(h.symbol);
  return (
    <tr className="cursor-pointer border-t border-line/60 hover:bg-raised/40" onClick={onClick} title="Click to edit">
      <td className="py-1.5">
        <button
          className="font-medium text-ink hover:text-accent hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            openChart(h.symbol, name);
          }}
          title={`Open ${name} chart`}
        >
          {name}
        </button>
        <p className="text-[11px] text-muted">
          {h.shares} sh{h.costBasis ? ` · avg ${m.full(h.costBasis)}` : ""}
        </p>
      </td>
      <td className="py-1.5">
        <Sparkline values={h.spark} baseline={h.previousClose} up={up} />
      </td>
      <td className="py-1.5 text-right text-ink-2">{h.price !== null ? m.full(h.price) : "—"}</td>
      <td className={`py-1.5 text-right whitespace-nowrap ${change === null ? "text-muted" : up ? "text-good" : "text-bad"}`}>
        {change === null ? "—" : `${up ? "▲" : "▼"} ${pct(change)}`}
      </td>
      <td className="py-1.5 text-right text-ink">{h.price !== null ? m.whole(h.price * h.shares) : "—"}</td>
    </tr>
  );
}

function HistoryChart({ points, m }: { points: { day: string; value: number }[]; m: Money }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 400;
  const H = 88;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - 4 - ((v - min) / (max - min || 1)) * (H - 12);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = `${line}L${W},${H}L0,${H}Z`;

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const hp = hover !== null ? points[hover] : null;
  return (
    <figure className="relative mb-1" aria-label="Portfolio value history">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full touch-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img">
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--color-axis)" vectorEffect="non-scaling-stroke" />
        <path d={area} fill="var(--color-accent)" opacity={0.1} />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--color-muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hp && hover !== null && (
        <>
          <span
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-accent"
            style={{ left: `${(hover / (points.length - 1)) * 100}%`, top: `${(y(hp.value) / H) * 100}%` }}
          />
          <div
            className="pointer-events-none absolute -top-1 -translate-y-full rounded-md border border-line bg-raised px-2 py-1 text-xs whitespace-nowrap shadow-lg"
            style={{ left: `clamp(0px, calc(${(hover / (points.length - 1)) * 100}% - 50px), calc(100% - 110px))` }}
          >
            <span className="text-muted">{new Date(parseYmd(hp.day)).toLocaleDateString([], { month: "short", day: "numeric" })}</span>{" "}
            <span className="font-medium text-ink tabular">{m.full(hp.value)}</span>
          </div>
        </>
      )}
      <figcaption className="flex justify-between text-[10px] text-muted tabular">
        <span>{new Date(parseYmd(points[0].day)).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
        <span>
          {m.whole(min)} – {m.whole(max)}
        </span>
      </figcaption>
    </figure>
  );
}

function HoldingForm({
  portfolio,
  initial,
  onSubmit,
  onCancel,
  onDelete,
}: {
  portfolio: PortfolioId;
  initial?: Holding;
  onSubmit: (h: HoldingInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [symbol, setSymbol] = useState(initial ? displaySymbol(initial.symbol) : "");
  const [shares, setShares] = useState(initial ? String(initial.shares) : "");
  const [cost, setCost] = useState(initial?.costBasis ? String(initial.costBasis) : "");
  const valid = symbol.trim() && Number(shares) > 0;
  const cfg = PORTFOLIOS[portfolio];
  // The server adds the exchange's main suffix to bare tickers; keep another one (e.g. .BO) when editing.
  const suffix = initial ? initial.symbol.slice(displaySymbol(initial.symbol).length) : "";

  return (
    <form
      className="mb-3 grid grid-cols-3 gap-2 rounded-xl border border-line bg-raised/40 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const s = symbol.trim().toUpperCase();
        if (valid) onSubmit({ symbol: s.includes(".") ? s : s + suffix, shares: Number(shares), costBasis: cost ? Number(cost) : null });
      }}
    >
      <input
        autoFocus
        className="input uppercase"
        placeholder={cfg.tickerExample}
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        aria-label={`${cfg.exchange} ticker`}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      />
      <input className="input" placeholder="Shares" inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} aria-label="Shares" />
      <input
        className="input"
        placeholder={`Avg ${currencySymbol(portfolio)} / share`}
        inputMode="decimal"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        aria-label="Average cost per share (optional)"
      />
      <div className="col-span-3 flex gap-2">
        {onDelete && (
          <button type="button" className="btn-ghost hover:text-bad" onClick={onDelete}>
            <Trash2 className="size-3.5" /> Remove
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!valid}>
            {initial ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </form>
  );
}
