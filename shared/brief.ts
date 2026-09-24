import type { Brief, CalendarEvent, EmailThread, MarketNote, Person, Rate } from "./types";

// Validates the snapshot written by the scheduled Claude task before it reaches D1, and
// again when the Worker reads it. The task summarizes untrusted email, so everything is
// type-checked, length-capped, and links are rebuilt rather than trusted.

const MAX_THREADS = 40;
const MAX_EVENTS = 100;
const ID = /^[0-9a-f]{8,32}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+$/;

export function gmailThreadUrl(account: string, threadId: string) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${threadId}`;
}

class BriefError extends Error {}

const obj = (v: unknown, path: string): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BriefError(`${path} must be an object`);
  return v as Record<string, unknown>;
};

const str = (v: unknown, path: string, max: number, optional = false): string => {
  if (v == null && optional) return "";
  if (typeof v !== "string") throw new BriefError(`${path} must be a string`);
  return v.trim().slice(0, max);
};

const num = (v: unknown, path: string): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new BriefError(`${path} must be a number`);
  return n;
};

const list = (v: unknown, path: string, max: number): unknown[] => {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new BriefError(`${path} must be an array`);
  return v.slice(0, max);
};

const date = (v: unknown, path: string): string | null => {
  if (v == null || v === "") return null;
  const d = str(v, path, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BriefError(`${path} must be YYYY-MM-DD`);
  return d;
};

const https = (v: unknown): string | null => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) ? v.slice(0, 500) : null);

function person(v: unknown, path: string): Person {
  const p = obj(v, path);
  const email = str(p.email, `${path}.email`, 200).toLowerCase();
  if (!EMAIL.test(email)) throw new BriefError(`${path}.email is not an email address`);
  return { name: str(p.name, `${path}.name`, 120, true) || email, email };
}

function thread(v: unknown, path: string, account: string): EmailThread {
  const t = obj(v, path);
  const threadId = str(t.threadId, `${path}.threadId`, 32);
  const lastMessageId = str(t.lastMessageId, `${path}.lastMessageId`, 32);
  if (!ID.test(threadId) || !ID.test(lastMessageId)) throw new BriefError(`${path} has an invalid Gmail id`);
  const suggested = str(t.suggestedReply, `${path}.suggestedReply`, 2000, true);
  return {
    threadId,
    lastMessageId,
    subject: str(t.subject, `${path}.subject`, 300, true) || "(no subject)",
    person: person(t.person, `${path}.person`),
    snippet: str(t.snippet, `${path}.snippet`, 400, true),
    date: num(t.date, `${path}.date`),
    unread: t.unread === true,
    messageCount: Math.max(1, Math.round(num(t.messageCount ?? 1, `${path}.messageCount`))),
    score: Math.round(num(t.score ?? 0, `${path}.score`)),
    reasons: list(t.reasons, `${path}.reasons`, 3).map((r, i) => str(r, `${path}.reasons[${i}]`, 40)).filter(Boolean),
    url: gmailThreadUrl(account, threadId),
    suggestedReply: suggested || null,
  };
}

function event(v: unknown, path: string): CalendarEvent {
  const e = obj(v, path);
  const start = num(e.start, `${path}.start`);
  const end = num(e.end, `${path}.end`);
  if (end < start) throw new BriefError(`${path} ends before it starts`);
  const allDay = e.allDay === true;
  const day = allDay ? date(e.day, `${path}.day`) : null;
  if (allDay && !day) throw new BriefError(`${path}.day must be YYYY-MM-DD`);
  return {
    id: str(e.id, `${path}.id`, 300),
    title: str(e.title, `${path}.title`, 200, true) || "(busy)",
    start,
    end,
    allDay,
    day,
    location: str(e.location, `${path}.location`, 200, true) || null,
    meetLink: https(e.meetLink),
    htmlLink: https(e.htmlLink),
    calendar: str(e.calendar, `${path}.calendar`, 100, true),
    color: null,
  };
}

function rate(v: unknown, path: string): Rate {
  const r = obj(v, path);
  return {
    name: str(r.name, `${path}.name`, 60),
    value: str(r.value, `${path}.value`, 30),
    asOf: date(r.asOf, `${path}.asOf`),
    nextLabel: str(r.nextLabel, `${path}.nextLabel`, 60, true) || null,
    nextDate: date(r.nextDate, `${path}.nextDate`),
    source: https(r.source),
  };
}

function note(v: unknown, path: string): MarketNote {
  const n = typeof v === "string" ? { text: v } : obj(v, path);
  return { text: str(n.text, `${path}.text`, 300), url: https(n.url) };
}

function markets(v: unknown): Brief["markets"] {
  if (v == null) return null;
  const m = obj(v, "markets");
  return {
    rates: list(m.rates, "markets.rates", 6).map((r, i) => rate(r, `markets.rates[${i}]`)),
    summary: list(m.summary, "markets.summary", 6).map((n, i) => note(n, `markets.summary[${i}]`)).filter((n) => n.text),
  };
}

/** Throws an Error describing the first problem; returns a clean copy otherwise. */
export function parseBrief(input: unknown, generatedAt: number): Brief {
  const b = obj(input, "brief");
  const account = str(b.account, "account", 200).toLowerCase();
  if (!EMAIL.test(account)) throw new BriefError("account must be an email address");
  const eventsAt = typeof b.eventsAt === "number" && Number.isFinite(b.eventsAt) && b.eventsAt > 0 ? b.eventsAt : generatedAt;
  return {
    generatedAt,
    eventsAt,
    account,
    needsReply: list(b.needsReply, "needsReply", MAX_THREADS).map((t, i) => thread(t, `needsReply[${i}]`, account)),
    waitingOn: list(b.waitingOn, "waitingOn", MAX_THREADS).map((t, i) => thread(t, `waitingOn[${i}]`, account)),
    events: list(b.events, "events", MAX_EVENTS).map((e, i) => event(e, `events[${i}]`)),
    markets: markets(b.markets),
  };
}
