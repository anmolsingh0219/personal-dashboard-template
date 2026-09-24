import { gmailThreadUrl } from "./brief.ts";
import { PORTFOLIO_ACTIONS, type PortfolioAction, type PortfolioEvent } from "./types.ts";

// Validates portfolio trade alerts found in email before scripts/push-portfolio.ts saves them.

const SOURCES = ["autopilot", "robinhood", "other"] as const;
const THREAD = /^[0-9a-f]{8,32}$/i;
const SYMBOL = /^[A-Z0-9.\-^=]{1,15}$/;

export type NewPortfolioEvent = Omit<PortfolioEvent, "seen">;

export function parsePortfolioEvents(input: unknown): NewPortfolioEvent[] {
  if (!input || typeof input !== "object") throw new Error("File must be a JSON object");
  const { account, events } = input as { account?: unknown; events?: unknown };
  if (typeof account !== "string" || !/^[^\s@]+@[^\s@]+$/.test(account)) throw new Error("account must be an email address");
  if (!Array.isArray(events)) throw new Error("events must be an array");
  if (events.length > 100) throw new Error("At most 100 events per push");

  return events.map((raw, i) => {
    const e = (raw ?? {}) as Record<string, unknown>;
    const path = `events[${i}]`;
    const action = e.action as PortfolioAction;
    if (!PORTFOLIO_ACTIONS.includes(action)) throw new Error(`${path}.action must be one of ${PORTFOLIO_ACTIONS.join(", ")}`);
    const source = (SOURCES as readonly string[]).includes(e.source as string) ? (e.source as NewPortfolioEvent["source"]) : "other";
    const threadId = typeof e.threadId === "string" ? e.threadId : "";
    if (!THREAD.test(threadId)) throw new Error(`${path}.threadId is not a Gmail id`);
    const index = Number.isInteger(e.index) ? (e.index as number) : 0;
    const occurredAt = Number(e.occurredAt);
    if (!Number.isFinite(occurredAt) || occurredAt <= 0) throw new Error(`${path}.occurredAt must be epoch milliseconds`);
    const symbol = typeof e.symbol === "string" && e.symbol.trim() ? e.symbol.trim().toUpperCase() : null;
    if (symbol && !SYMBOL.test(symbol)) throw new Error(`${path}.symbol looks wrong`);
    const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    return {
      id: `${threadId}:${index}`,
      occurredAt,
      portfolio: text(e.portfolio, 80) ?? "Claude portfolio",
      action,
      symbol,
      detail: text(e.detail, 200),
      source,
      url: gmailThreadUrl(account.toLowerCase(), threadId),
    };
  });
}
