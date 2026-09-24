import { gmailThreadUrl } from "../../shared/brief";
import type { EmailThread, Person } from "../../shared/types";

// Decides which Gmail threads need a reply and which are waiting on someone else.
// Pure functions over Gmail's `format=metadata` thread shape, so they're unit-testable.

export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[] };
}
export interface GmailThread {
  id: string;
  messages?: GmailMessage[];
}

export const METADATA_HEADERS = ["From", "To", "Cc", "Subject", "List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted"];

const DAY = 86_400_000;
const WAITING_MIN_AGE = 2 * DAY;
const WAITING_MAX_AGE = 30 * DAY;
const BULK_CATEGORIES = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];
const ROBOT_LOCALPART = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|bounces?|newsletters?|alerts?|automated|digest)([+._-].*)?$/i;

export function header(msg: GmailMessage, name: string): string {
  const lower = name.toLowerCase();
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

export function parseAddress(raw: string): Person {
  const trimmed = raw.trim();
  const angle = trimmed.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, "$1").trim();
    const email = angle[2].trim().toLowerCase();
    return { name: name || email, email };
  }
  const email = trimmed.replace(/^"|"$/g, "").toLowerCase();
  return { name: email, email };
}

/** Split an address-list header on commas that aren't inside quotes or angle brackets. */
export function parseAddressList(raw: string): Person[] {
  const out: Person[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<") angle = true;
    else if (ch === ">") angle = false;
    if (ch === "," && !quoted && !angle) {
      if (cur.trim()) out.push(parseAddress(cur));
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(parseAddress(cur));
  return out.filter((p) => p.email.includes("@"));
}

export const isRobotAddress = (email: string) => ROBOT_LOCALPART.test(email.split("@")[0] ?? "");

export function isAutomated(msg: GmailMessage): boolean {
  if (header(msg, "List-Unsubscribe") || header(msg, "List-Id")) return true;
  if (/^(bulk|list|junk)$/i.test(header(msg, "Precedence").trim())) return true;
  const auto = header(msg, "Auto-Submitted").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  return isRobotAddress(parseAddress(header(msg, "From")).email);
}

const hasLabel = (msg: GmailMessage, label: string) => msg.labelIds?.includes(label) ?? false;

export function isMine(msg: GmailMessage, me: Set<string>) {
  return hasLabel(msg, "SENT") || me.has(parseAddress(header(msg, "From")).email);
}

/** Addresses the user sends from: the connected account, configured aliases, and any From on SENT mail. */
export function collectMyAddresses(threads: GmailThread[], account: string, aliases: string[]): Set<string> {
  const me = new Set([account, ...aliases].map((a) => a.trim().toLowerCase()).filter(Boolean));
  for (const t of threads) for (const m of t.messages ?? []) if (hasLabel(m, "SENT")) me.add(parseAddress(header(m, "From")).email);
  return me;
}

function ageLabel(ms: number) {
  const days = Math.floor(ms / DAY);
  if (days >= 1) return `${days}d old`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours}h old` : "just now";
}

export type Classification = { kind: "needs_reply" | "waiting_on"; thread: EmailThread } | null;

export function classifyThread(thread: GmailThread, me: Set<string>, account: string, now: number): Classification {
  const messages = (thread.messages ?? []).filter((m) => !hasLabel(m, "DRAFT"));
  const last = messages.at(-1);
  if (!last) return null;

  const date = Number(last.internalDate);
  const age = now - date;
  const subject = header(messages[0], "Subject") || "(no subject)";
  const base = {
    threadId: thread.id,
    lastMessageId: last.id,
    subject,
    snippet: decodeEntities(last.snippet ?? ""),
    date,
    unread: messages.some((m) => hasLabel(m, "UNREAD")),
    messageCount: messages.length,
    url: gmailThreadUrl(account, thread.id),
  };

  if (isMine(last, me)) {
    if (age < WAITING_MIN_AGE || age > WAITING_MAX_AGE) return null;
    const recipients = parseAddressList(header(last, "To")).filter((p) => !me.has(p.email) && !isRobotAddress(p.email));
    if (recipients.length === 0) return null;
    const extra = recipients.length > 1 ? ` +${recipients.length - 1}` : "";
    return {
      kind: "waiting_on",
      thread: { ...base, person: { ...recipients[0], name: recipients[0].name + extra }, score: Math.floor(age / DAY), reasons: [`No reply for ${Math.floor(age / DAY)}d`] },
    };
  }

  if (!hasLabel(last, "INBOX")) return null;
  if (BULK_CATEGORIES.some((c) => hasLabel(last, c))) return null;
  if (isAutomated(last)) return null;

  const participated = messages.some((m) => isMine(m, me));
  const direct = parseAddressList(header(last, "To")).some((p) => me.has(p.email));
  const starred = messages.some((m) => hasLabel(m, "STARRED"));
  if (!participated && !direct && !starred) return null;

  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason?: string) => {
    score += points;
    if (reason) reasons.push(reason);
  };
  if (participated) add(3, "Ongoing thread");
  else if (direct) add(2, "Sent to you");
  if (starred) add(3, "Starred");
  if (hasLabel(last, "IMPORTANT")) add(1);
  if (base.unread) add(1);
  if (base.snippet.includes("?")) add(1, "Question");
  if (age > WAITING_MIN_AGE) add(1, ageLabel(age));

  return { kind: "needs_reply", thread: { ...base, person: parseAddress(header(last, "From")), score, reasons } };
}

export function triage(threads: GmailThread[], account: string, aliases: string[], now: number) {
  const me = collectMyAddresses(threads, account, aliases);
  const seen = new Set<string>();
  const needsReply: EmailThread[] = [];
  const waitingOn: EmailThread[] = [];
  for (const t of threads) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const result = classifyThread(t, me, account, now);
    if (result?.kind === "needs_reply") needsReply.push(result.thread);
    else if (result?.kind === "waiting_on") waitingOn.push(result.thread);
  }
  needsReply.sort((a, b) => b.score - a.score || b.date - a.date);
  waitingOn.sort((a, b) => a.date - b.date);
  return { needsReply, waitingOn };
}

function decodeEntities(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
