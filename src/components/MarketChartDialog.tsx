import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EVENT_KINDS, eventsFor, regionFor, type MarketEvent } from "../../shared/marketEvents";
import type { Bar, ChartRange, ChartResponse, MarketsResponse } from "../../shared/types";
import { api } from "../lib/api";
import { ErrorNote, Spinner } from "./ui";

const RANGES: [ChartRange, string][] = [
  ["1d", "1D"],
  ["5d", "5D"],
  ["1mo", "1M"],
  ["6mo", "6M"],
  ["1y", "1Y"],
  ["5y", "5Y"],
  ["2020", "2020→"],
];

// Chart chrome from the app's dark tokens.
const C = { bg: "#1a1a19", text: "#898781", grid: "#242422", axis: "#383835", up: "#0ca30c", down: "#ef6b6b", accent: "#3987e5" };

const DAY = 86_400;
const LABEL_ROW = 22;
const MAX_ROWS = 5;
const EVENTS_PREF = "dash:chart-events";

/** lightweight-charts renders UTC; shift intraday bars so the axis reads in local time. */
const localTime = (t: number) => (t - new Date(t * 1000).getTimezoneOffset() * 60) as UTCTimestamp;
const utcDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const localDate = (t: number) => {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const readPref = () => {
  try {
    return localStorage.getItem(EVENTS_PREF) !== "off";
  } catch {
    return true;
  }
};

interface PlacedEvent extends MarketEvent {
  time: UTCTimestamp;
}

interface DrawnEvent {
  event: PlacedEvent;
  x: number;
  /** Label row, or null when there was no room (the line is still drawn). */
  row: number | null;
  labelLeft: number;
}

/** Place a label at each event line, stacking into rows so labels never overlap. */
function layoutEvents(chart: IChartApi, events: PlacedEvent[], plotWidth: number): DrawnEvent[] {
  const ts = chart.timeScale();
  const rowEnds: number[] = [];
  const out: DrawnEvent[] = [];
  for (const event of [...events].sort((a, b) => a.time - b.time)) {
    const x = ts.timeToCoordinate(event.time);
    if (x === null || x < 0 || x > plotWidth) continue;
    const width = event.label.length * 6.3 + 16;
    // Labels sit right of their line, or left of it near the right edge.
    const labelLeft = x + width > plotWidth ? x - width : x;
    let row = rowEnds.findIndex((end) => end + 6 <= labelLeft);
    if (row === -1 && rowEnds.length < MAX_ROWS) row = rowEnds.push(0) - 1;
    if (row !== -1) rowEnds[row] = labelLeft + width;
    out.push({ event, x, row: row === -1 ? null : row, labelLeft });
  }
  return out;
}

export default function MarketChartDialog({ symbol, name, onClose }: { symbol: string; name: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);

  const [range, setRange] = useState<ChartRange>("2020");
  const [style, setStyle] = useState<"candles" | "line">("candles");
  const [showEvents, setShowEvents] = useState(readPref);
  const [hover, setHover] = useState<{ bar: Bar; label: string; time: number } | null>(null);
  // Bumped whenever the visible range or size changes, so event lines follow the chart.
  const [layoutTick, setLayoutTick] = useState(0);

  const region = regionFor(symbol);
  // The tile's live quote; futures history can lag it on contract-roll days.
  const live = useQueryClient().getQueryData<MarketsResponse>(["markets"])?.quotes.find((q) => q.symbol === symbol)?.price ?? null;

  const chart = useQuery({
    queryKey: ["chart", symbol, range],
    queryFn: () => api.get<ChartResponse>(`/markets/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`),
    staleTime: 60_000,
  });
  const data = chart.data;
  const intraday = data?.intraday ?? false;
  const toTime = (t: number) => (intraday ? localTime(t) : (t as UTCTimestamp));

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function toggleEvents() {
    setShowEvents((on) => {
      try {
        localStorage.setItem(EVENTS_PREF, on ? "off" : "on");
      } catch {}
      return !on;
    });
  }

  // Create the chart once.
  useEffect(() => {
    if (!boxRef.current) return;
    const c = createChart(boxRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text, fontFamily: "system-ui, -apple-system, sans-serif", attributionLogo: false },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      // Headroom at the top for the event labels.
      rightPriceScale: { borderColor: C.axis, scaleMargins: { top: 0.28, bottom: 0.06 } },
      timeScale: { borderColor: C.axis, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = c;
    const bump = () => setLayoutTick((n) => n + 1);
    c.timeScale().subscribeVisibleLogicalRangeChange(bump);
    const resize = new ResizeObserver(bump);
    resize.observe(boxRef.current);
    return () => {
      resize.disconnect();
      c.timeScale().unsubscribeVisibleLogicalRangeChange(bump);
      c.remove();
      chartRef.current = null;
    };
  }, []);

  // (Re)build the series when the style or data changes.
  useEffect(() => {
    const c = chartRef.current;
    if (!c || !data) return;
    if (seriesRef.current) c.removeSeries(seriesRef.current);
    const series =
      style === "candles"
        ? c.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down })
        : c.addSeries(AreaSeries, { lineColor: C.accent, topColor: "rgba(57,135,229,0.28)", bottomColor: "rgba(57,135,229,0.02)", lineWidth: 2 });
    if (style === "candles") (series as ISeriesApi<"Candlestick">).setData(data.bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    else (series as ISeriesApi<"Area">).setData(data.bars.map((b) => ({ time: toTime(b.t), value: b.c })));
    seriesRef.current = series;
    c.applyOptions({ timeScale: { timeVisible: data.intraday, secondsVisible: false } });
    c.timeScale().fitContent();
    setLayoutTick((n) => n + 1);

    const byTime = new Map(data.bars.map((b) => [toTime(b.t) as number, b]));
    const handler = (p: { time?: Time }) => {
      const bar = p.time !== undefined ? byTime.get(p.time as number) : undefined;
      setHover(
        bar
          ? {
              bar,
              time: p.time as number,
              label: new Date((p.time as number) * 1000).toLocaleString([], {
                timeZone: "UTC",
                ...(data.intraday ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { year: "numeric", month: "short", day: "numeric" }),
              }),
            }
          : null,
      );
    };
    c.subscribeCrosshairMove(handler);
    return () => c.unsubscribeCrosshairMove(handler);
  }, [data, style]);

  // This market's events (India or US, plus global), snapped to the first bar on or after each date.
  const placed = useMemo<PlacedEvent[]>(() => {
    if (!data?.bars.length) return [];
    const dateOf = data.intraday ? localDate : utcDate;
    const first = dateOf(data.bars[0].t);
    const last = dateOf(data.bars[data.bars.length - 1].t);
    return eventsFor(symbol)
      .filter((e) => e.date >= first && e.date <= last)
      .flatMap((e) => {
        const bar = data.bars.find((b) => dateOf(b.t) >= e.date);
        return bar ? [{ ...e, time: (data.intraday ? localTime(bar.t) : bar.t) as UTCTimestamp }] : [];
      })
      .sort((a, b) => a.time - b.time);
  }, [data, symbol]);

  // Recomputed on pan, zoom and resize (layoutTick) so the lines stay on their dates.
  const drawn = useMemo(() => {
    const c = chartRef.current;
    const box = boxRef.current;
    if (!c || !box || !showEvents || !seriesRef.current || layoutTick < 0) return { events: [] as DrawnEvent[], plotHeight: 0 };
    const plotWidth = box.clientWidth - c.priceScale("right").width();
    const plotHeight = box.clientHeight - c.timeScale().height();
    return { events: layoutEvents(c, placed, plotWidth), plotHeight };
  }, [placed, showEvents, layoutTick]);

  const hoverEvents = hover && showEvents ? placed.filter((e) => e.time === hover.time) : [];
  const kindsShown = [...new Set(placed.map((e) => e.kind))];

  function focus(e: PlacedEvent) {
    if (!data || data.intraday) return;
    chartRef.current?.timeScale().setVisibleRange({ from: (e.time - 120 * DAY) as UTCTimestamp, to: (e.time + 120 * DAY) as UTCTimestamp });
  }

  const fmt = (n: number) => `${data?.currency ?? ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const bars = data?.bars ?? [];
  const lastBar = bars.at(-1);
  const change = bars.length > 1 && lastBar ? (lastBar.c - bars[0].o) / bars[0].o : null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      className="m-auto h-[min(840px,calc(100dvh-1rem))] w-[min(1200px,calc(100vw-1rem))] max-w-none overflow-hidden rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/70"
      aria-label={`${name} chart`}
    >
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-sm text-muted">
              {name} <span className="text-xs">{symbol}</span>
            </h2>
            <p className="text-2xl font-semibold tracking-tight tabular">
              {hover ? fmt(hover.bar.c) : live !== null ? fmt(live) : lastBar ? fmt(lastBar.c) : "—"}
              {data?.unit && <span className="ml-1 text-sm font-normal text-muted">/{data.unit}</span>}
            </p>
            <p className="h-4 text-xs text-muted tabular">
              {hover ? (
                <>
                  {hover.label} · O {fmt(hover.bar.o)} H {fmt(hover.bar.h)} L {fmt(hover.bar.l)} C {fmt(hover.bar.c)}
                </>
              ) : (
                change !== null && (
                  <span className={change >= 0 ? "text-good" : "text-bad"}>
                    {change >= 0 ? "▲" : "▼"} {Math.abs(change * 100).toFixed(2)}% over {RANGES.find(([r]) => r === range)?.[1]}
                  </span>
                )
              )}
            </p>
            <p className="h-4 truncate text-xs text-ink-2">
              {hoverEvents.map((e) => (
                <span key={e.label} className="mr-3 inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: EVENT_KINDS[e.kind].color }} aria-hidden />
                  <span className="font-medium text-ink">{e.label}</span> {e.detail}
                </span>
              ))}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              role="switch"
              aria-checked={showEvents}
              onClick={toggleEvents}
              className="inline-flex items-center gap-2 rounded-lg bg-raised px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink"
              title={`${region === "india" ? "India" : "US"} and global events since 2020`}
            >
              <span className={`relative h-4 w-7 rounded-full transition ${showEvents ? "bg-accent" : "bg-axis"}`}>
                <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${showEvents ? "left-3.5" : "left-0.5"}`} />
              </span>
              Major events
            </button>
            <div className="flex rounded-lg bg-raised p-0.5 text-xs" role="radiogroup" aria-label="Time range">
              {RANGES.map(([r, label]) => (
                <button
                  key={r}
                  role="radio"
                  aria-checked={range === r}
                  onClick={() => setRange(r)}
                  className={`rounded-md px-2 py-1 font-medium transition ${range === r ? "bg-card text-ink shadow" : "text-muted hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg bg-raised p-0.5 text-xs" role="radiogroup" aria-label="Chart type">
              {(["candles", "line"] as const).map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={style === s}
                  onClick={() => setStyle(s)}
                  className={`rounded-md px-2 py-1 font-medium capitalize transition ${style === s ? "bg-card text-ink shadow" : "text-muted hover:text-ink"}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close chart">
              <X className="size-4" />
            </button>
          </div>
        </header>

        {showEvents && kindsShown.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2 text-[11px] text-muted sm:px-5" aria-label="Event legend">
            <span className="text-ink-2">{region === "india" ? "India + global events" : "US + global events"}</span>
            {kindsShown.map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: EVENT_KINDS[k].color }} aria-hidden />
                {EVENT_KINDS[k].label}
              </span>
            ))}
          </div>
        )}

        <div className="relative min-h-0 flex-1 px-2 pt-1 sm:px-3">
          <div className="relative h-full w-full">
            <div ref={boxRef} className="h-full w-full" />
            {showEvents && (
              <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
                {drawn.events.map(({ event, x, row, labelLeft }) => {
                  const color = EVENT_KINDS[event.kind].color;
                  return (
                    <div key={event.date + event.label}>
                      <div className="absolute top-0 border-l border-dashed" style={{ left: x, height: drawn.plotHeight, borderColor: `${color}aa` }} />
                      {row !== null && (
                        <div
                          className="absolute rounded-sm bg-raised/95 px-1.5 py-px text-[11px] leading-4 font-medium whitespace-nowrap text-ink-2 shadow"
                          style={{ left: labelLeft, top: 4 + row * LABEL_ROW, borderLeft: `2px solid ${color}` }}
                        >
                          {event.label}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {chart.isFetching && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner className="size-6 text-muted" />
            </div>
          )}
          {chart.error && (
            <div className="absolute inset-x-6 top-6">
              <ErrorNote error={chart.error} />
            </div>
          )}
        </div>

        {showEvents && placed.length > 0 && (
          <ul className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto border-t border-line px-4 py-2.5 sm:px-5" aria-label="Events in this range">
            {placed.map((e) => (
              <li key={e.date + e.label}>
                <button onClick={() => focus(e)} title={e.detail} className="inline-flex items-center gap-1.5 rounded-md bg-raised px-2 py-1 text-xs text-ink-2 transition hover:text-ink">
                  <span className="size-2 rounded-full" style={{ background: EVENT_KINDS[e.kind].color }} aria-hidden />
                  <span className="text-muted tabular">{new Date(`${e.date}T12:00:00`).toLocaleDateString([], { month: "short", year: "2-digit" })}</span>
                  {e.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
