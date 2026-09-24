import { BellRing, Briefcase, Command, ListTodo, Mail, Search, Settings, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { PORTFOLIO_IDS, PORTFOLIOS } from "../../shared/config";
import { defaultPortfolio } from "../../shared/marketHours";
import { useEmail, useJobs, usePortfolioEvents, useStocks, useTasks } from "../lib/queries";
import { daysUntil, fmtDuration, fmtTime, startOfDay } from "../lib/time";
import { useDayData } from "../lib/usePlanner";

interface Slot {
  title: string;
  start: number;
  end: number;
  kind: "block" | "event";
}

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The top of the page: what you should be doing right now, what's next, and what needs attention. */
export function NowStrip({ now, onOpenPalette, onOpenSettings }: { now: number; onOpenPalette: () => void; onOpenSettings: () => void }) {
  const { events, blockList } = useDayData(startOfDay(now));
  const email = useEmail().data;
  const tasks = useTasks().data?.tasks ?? [];
  const stocks = useStocks().data;
  const jobs = useJobs().data ?? [];
  const newTrades = (usePortfolioEvents().data ?? []).filter((e) => !e.seen).length;

  const slots: Slot[] = [
    ...events.filter((e) => !e.allDay).map((e) => ({ title: e.title, start: e.start, end: e.end, kind: "event" as const })),
    ...blockList.filter((b) => !b.done).map((b) => ({ title: b.title, start: b.start, end: b.end, kind: "block" as const })),
  ].sort((a, b) => a.start - b.start);

  const current = slots.filter((s) => s.start <= now && now < s.end).sort((a, b) => (a.kind === "block" ? -1 : 1) - (b.kind === "block" ? -1 : 1))[0];
  const next = slots.find((s) => s.start > now);
  const missed = blockList.filter((b) => !b.done && b.end < now).length;

  const dueToday = tasks.filter((t) => t.due && daysUntil(t.due, now) <= 0).length;
  const replies = email?.needsReply.length ?? 0;
  // Same portfolio the Portfolio panel shows by default: the live market, else the last to close.
  const livePortfolio = defaultPortfolio(now);
  const live = stocks?.portfolios[livePortfolio];
  const t = live?.totals;
  const dayPct = t && t.previousValue && live.holdings.length ? t.dayChange / t.previousValue : null;
  const jobSteps = jobs.filter((j) => j.nextStepOn && daysUntil(j.nextStepOn, now) <= 0).length;

  return (
    <header className="shrink-0 rounded-2xl border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-44">
          <p className="text-sm text-muted">
            {greeting(now)} · {new Date(now).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <p className="text-3xl font-semibold tracking-tight text-ink tabular">{fmtTime(now)}</p>
        </div>

        <div className="min-w-60 flex-1 space-y-1">
          {current ? (
            <div>
              <p className="text-xs font-medium text-accent">{current.kind === "block" ? "Now" : "In"}</p>
              <p className="truncate text-lg font-medium text-ink">{current.title}</p>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={Math.round(((now - current.start) / (current.end - current.start)) * 100)}>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${((now - current.start) / (current.end - current.start)) * 100}%` }} />
                </div>
                <span className="text-xs text-ink-2 tabular">{fmtDuration(current.end - now)} left</span>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs font-medium text-muted">Now</p>
              <p className="text-lg font-medium text-ink-2">
                {next ? `Free until ${fmtTime(next.start)}` : slots.length ? "Done for today" : "Nothing planned — drag a task onto the schedule"}
                {next && <span className="text-sm font-normal text-muted"> · {fmtDuration(next.start - now)}</span>}
              </p>
            </div>
          )}
          {next && (
            <p className="truncate text-sm text-ink-2">
              <span className="text-muted">Next</span> {next.title} <span className="text-muted tabular">at {fmtTime(next.start)}</span>
            </p>
          )}
          {missed > 0 && (
            <a href="#planner" className="inline-block text-xs text-warn hover:underline">
              {missed} missed block{missed > 1 ? "s" : ""} — reschedule
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Stat href="#inbox" icon={<Mail className="size-4" />} value={email ? replies : "–"} label="to reply" tone={replies > 0 ? "text-ink" : "text-muted"} />
          <Stat href="#tasks" icon={<ListTodo className="size-4" />} value={dueToday} label="due today" tone={dueToday > 0 ? "text-warn" : "text-muted"} />
          {jobSteps > 0 && <Stat href="#jobs" icon={<Briefcase className="size-4" />} value={jobSteps} label={jobSteps === 1 ? "job step" : "job steps"} tone="text-warn" />}
          {dayPct !== null && (
            <Stat
              href="#stocks"
              icon={dayPct >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
              value={`${dayPct >= 0 ? "+" : "−"}${Math.abs(dayPct * 100).toFixed(2)}%`}
              label={PORTFOLIO_IDS.length > 1 ? `${PORTFOLIOS[livePortfolio].label} stocks` : "stocks"}
              tone={dayPct >= 0 ? "text-good" : "text-bad"}
            />
          )}
          {newTrades > 0 && <Stat href="#alerts" icon={<BellRing className="size-4" />} value={newTrades} label={newTrades === 1 ? "new trade" : "new trades"} tone="text-accent" />}
          <div className="flex gap-1">
            <button className="btn-ghost border border-line" onClick={onOpenPalette} aria-label="Open command palette">
              <Search className="size-4 sm:hidden" />
              <Command className="hidden size-3.5 sm:block" />
              <span className="hidden sm:inline">K</span>
            </button>
            <button className="icon-btn size-8.5 border border-line" onClick={onOpenSettings} aria-label="Settings" title="Settings">
              <Settings className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function Stat({ href, icon, value, label, tone }: { href: string; icon: ReactNode; value: ReactNode; label: string; tone: string }) {
  return (
    <a href={href} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 transition hover:bg-raised">
      <span className="text-muted">{icon}</span>
      <span className={`text-lg leading-none font-semibold tabular ${tone}`}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </a>
  );
}
