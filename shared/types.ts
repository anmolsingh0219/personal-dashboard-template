// Types shared by the Worker API and the React client.

import type { PortfolioId } from "./config.ts";

export interface ApiError {
  error: string;
  code?: "google_not_connected" | "scope_missing" | "google_not_configured" | "not_found" | "bad_request";
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  scopes: string[];
}

export interface Person {
  name: string;
  email: string;
}

export interface EmailThread {
  threadId: string;
  lastMessageId: string;
  subject: string;
  /** The other party: sender for needs-reply, first recipient for waiting-on. */
  person: Person;
  snippet: string;
  date: number;
  unread: boolean;
  messageCount: number;
  score: number;
  reasons: string[];
  url: string;
  /** Draft written by the scheduled Claude task; never sent automatically. */
  suggestedReply?: string | null;
}

export interface EmailResponse {
  account: string;
  needsReply: EmailThread[];
  waitingOn: EmailThread[];
  fetchedAt: number;
  /** "google": live via the dashboard's own OAuth. "claude": snapshot from the scheduled task. */
  source: "google" | "claude";
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  /** YYYY-MM-DD for all-day events (their start/end are not meaningful instants). */
  day: string | null;
  location: string | null;
  meetLink: string | null;
  htmlLink: string | null;
  calendar: string;
  color: string | null;
}

export interface CalendarResponse {
  connected: boolean;
  events: CalendarEvent[];
  source: "google" | "claude" | null;
  updatedAt: number | null;
}

/** A policy rate looked up by the scheduled Claude task, e.g. the RBI repo rate. */
export interface Rate {
  name: string;
  /** Display value, e.g. "5.50%" or "4.00–4.25%". */
  value: string;
  /** YYYY-MM-DD the rate was last set. */
  asOf: string | null;
  /** e.g. "Next MPC decision" / "Next FOMC decision". */
  nextLabel: string | null;
  nextDate: string | null;
  source: string | null;
}

export interface MarketNote {
  text: string;
  url: string | null;
}

/** Snapshot the scheduled Claude task pushes into D1 (see scripts/push-brief.ts). */
export interface Brief {
  generatedAt: number;
  /** When `events` were fetched. A calendar-only refresh moves this without touching the rest. */
  eventsAt: number;
  account: string;
  needsReply: EmailThread[];
  waitingOn: EmailThread[];
  events: CalendarEvent[];
  markets: { rates: Rate[]; summary: MarketNote[] } | null;
}

export interface MarketQuote {
  symbol: string;
  name: string;
  /** "$" for commodities priced in dollars; null for index points. */
  currency: string | null;
  unit: string | null;
  price: number | null;
  previousClose: number | null;
  spark: number[];
}

export interface Headline {
  title: string;
  url: string;
  source: string;
  publishedAt: number | null;
}

export interface MarketsResponse {
  quotes: MarketQuote[];
  headlines: Headline[];
  rates: Rate[];
  summary: MarketNote[];
  /** When the rates and summary were last refreshed by Claude. */
  briefAt: number | null;
  quotesAt: number;
}

export interface Task {
  /** 'local:<id>' or 'google:<listId>:<taskId>' */
  key: string;
  source: "local" | "google";
  list: string | null;
  title: string;
  notes: string | null;
  /** YYYY-MM-DD */
  due: string | null;
  done: boolean;
  estimateMin: number | null;
}

export interface TasksResponse {
  googleConnected: boolean;
  googleError: string | null;
  tasks: Task[];
}

export interface Block {
  id: string;
  title: string;
  start: number;
  end: number;
  taskKey: string | null;
  done: boolean;
  mirrored: boolean;
}

export interface NewBlock {
  title: string;
  start: number;
  end: number;
  taskKey?: string | null;
}

export interface Settings {
  mirrorCalendar: boolean;
  /** Minutes after midnight the planner starts/ends. */
  dayStartMin: number;
  dayEndMin: number;
  defaultEstimateMin: number;
  emailAliases: string;
  readInterests: string;
}

export interface Holding {
  id: string;
  /** Yahoo symbol, with the exchange suffix outside the US (e.g. .NS for NSE). */
  symbol: string;
  portfolio: PortfolioId;
  shares: number;
  costBasis: number | null;
  price: number | null;
  previousClose: number | null;
  /** Intraday closes for the sparkline. */
  spark: number[];
}

export interface PortfolioView {
  /** ISO currency the holdings are priced in. */
  currency: string;
  holdings: Holding[];
  totals: { value: number; cost: number; dayChange: number; previousValue: number };
  history: { day: string; value: number }[];
}

export interface StocksResponse {
  portfolios: Record<PortfolioId, PortfolioView>;
  quotesAt: number;
}

export const STAGES = ["saved", "applied", "oa", "interview", "offer", "rejected"] as const;
export type Stage = (typeof STAGES)[number];

export interface Application {
  id: string;
  company: string;
  role: string;
  stage: Stage;
  url: string | null;
  location: string | null;
  notes: string | null;
  appliedOn: string | null;
  nextStep: string | null;
  nextStepOn: string | null;
  /** Gmail thread that last updated this application, when it came from email. */
  emailUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ReadPick {
  id: string;
  title: string;
  url: string;
  discussionUrl: string;
  source: string;
  points: number;
  comments: number;
}

export interface PicksResponse {
  read: ReadPick | null;
  readNote: string | null;
}

export type PickVerdict = "save" | "seen" | "skip";

export interface SavedPick {
  itemId: string;
  title: string;
  url: string | null;
  createdAt: number;
}

export const CHART_RANGES = ["1d", "5d", "1mo", "6mo", "1y", "5y", "2020"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

export interface Bar {
  /** Unix seconds */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface ChartResponse {
  symbol: string;
  name: string;
  currency: string | null;
  unit: string | null;
  range: ChartRange;
  intraday: boolean;
  bars: Bar[];
}

export const PORTFOLIO_ACTIONS = ["buy", "sell", "rebalance", "note"] as const;
export type PortfolioAction = (typeof PORTFOLIO_ACTIONS)[number];

/** A trade or adjustment in a portfolio the owner follows (e.g. one copied on Autopilot, or a newsletter's model portfolio). */
export interface PortfolioEvent {
  id: string;
  occurredAt: number;
  portfolio: string;
  action: PortfolioAction;
  symbol: string | null;
  /** e.g. "Weight 4% → 7%" or "Bought 0.31 sh at $70.12" */
  detail: string | null;
  source: "autopilot" | "robinhood" | "other";
  url: string | null;
  seen: boolean;
}
