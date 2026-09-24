import { describe, expect, it } from "vitest";
import { classifyThread, collectMyAddresses, parseAddressList, triage, type GmailMessage, type GmailThread } from "../worker/lib/emailRules";
import { parseBatch } from "../worker/lib/gmailBatch";

const ME = "abc123@example.edu";
const NOW = Date.parse("2026-09-22T15:00:00Z");
const DAY = 86_400_000;

let seq = 0;
function msg(opts: { from: string; to?: string; cc?: string; labels?: string[]; ago?: number; snippet?: string; subject?: string; extra?: Record<string, string> }): GmailMessage {
  const headers = [
    { name: "From", value: opts.from },
    { name: "To", value: opts.to ?? ME },
    { name: "Subject", value: opts.subject ?? "Hello" },
    ...(opts.cc ? [{ name: "Cc", value: opts.cc }] : []),
    ...Object.entries(opts.extra ?? {}).map(([name, value]) => ({ name, value })),
  ];
  return {
    id: `m${++seq}`,
    threadId: "t",
    labelIds: opts.labels ?? ["INBOX"],
    internalDate: String(NOW - (opts.ago ?? 3_600_000)),
    snippet: opts.snippet ?? "hi",
    payload: { headers },
  };
}
const thread = (...messages: GmailMessage[]): GmailThread => ({ id: `t${++seq}`, messages });
const me = new Set([ME]);

describe("parseAddressList", () => {
  it("handles quoted names with commas", () => {
    expect(parseAddressList(`"Doe, Jane" <jane@x.com>, bob@y.com`)).toEqual([
      { name: "Doe, Jane", email: "jane@x.com" },
      { name: "bob@y.com", email: "bob@y.com" },
    ]);
  });
});

describe("classifyThread — needs reply", () => {
  it("flags a direct email from a person", () => {
    const r = classifyThread(thread(msg({ from: "Prof Kim <kim@example.edu>", snippet: "Can you send the draft?" })), me, ME, NOW);
    expect(r?.kind).toBe("needs_reply");
    expect(r?.thread.person).toEqual({ name: "Prof Kim", email: "kim@example.edu" });
    expect(r?.thread.reasons).toContain("Question");
  });

  it("ignores newsletters and mailing lists", () => {
    const list = msg({ from: "Club <club@example.edu>", extra: { "List-Id": "<club.example.edu>" } });
    const bulk = msg({ from: "News <news@example.edu>", extra: { Precedence: "bulk" } });
    const unsub = msg({ from: "Shop <deals@shop.com>", extra: { "List-Unsubscribe": "<mailto:u@shop.com>" } });
    for (const m of [list, bulk, unsub]) expect(classifyThread(thread(m), me, ME, NOW)).toBeNull();
  });

  it("ignores no-reply senders and auto-replies", () => {
    expect(classifyThread(thread(msg({ from: "no-reply@greenhouse.io" })), me, ME, NOW)).toBeNull();
    expect(classifyThread(thread(msg({ from: "Ann <ann@x.com>", extra: { "Auto-Submitted": "auto-replied" } })), me, ME, NOW)).toBeNull();
  });

  it("ignores mail where I'm only CC'd and never replied", () => {
    expect(classifyThread(thread(msg({ from: "ann@x.com", to: "team@x.com", cc: ME })), me, ME, NOW)).toBeNull();
  });

  it("keeps CC'd mail once I've taken part in the thread", () => {
    const t = thread(msg({ from: ME, to: "ann@x.com", labels: ["SENT"], ago: 2 * 3_600_000 }), msg({ from: "ann@x.com", to: "team@x.com", cc: ME }));
    const r = classifyThread(t, me, ME, NOW);
    expect(r?.kind).toBe("needs_reply");
    expect(r?.thread.reasons).toContain("Ongoing thread");
  });

  it("ignores archived threads and bulk categories", () => {
    expect(classifyThread(thread(msg({ from: "ann@x.com", labels: [] })), me, ME, NOW)).toBeNull();
    expect(classifyThread(thread(msg({ from: "ann@x.com", labels: ["INBOX", "CATEGORY_PROMOTIONS"] })), me, ME, NOW)).toBeNull();
  });

  it("skips drafts when finding the last message", () => {
    const t = thread(msg({ from: "ann@x.com" }), msg({ from: ME, labels: ["DRAFT"] }));
    expect(classifyThread(t, me, ME, NOW)?.kind).toBe("needs_reply");
  });
});

describe("classifyThread — waiting on", () => {
  it("flags my sent mail with no reply after 2 days", () => {
    const r = classifyThread(thread(msg({ from: ME, to: "Recruiter <r@corp.com>", labels: ["SENT"], ago: 4 * DAY })), me, ME, NOW);
    expect(r?.kind).toBe("waiting_on");
    expect(r?.thread.person.email).toBe("r@corp.com");
  });

  it("ignores recent or very old sent mail, and mail to robots", () => {
    expect(classifyThread(thread(msg({ from: ME, to: "r@corp.com", labels: ["SENT"], ago: DAY })), me, ME, NOW)).toBeNull();
    expect(classifyThread(thread(msg({ from: ME, to: "r@corp.com", labels: ["SENT"], ago: 40 * DAY })), me, ME, NOW)).toBeNull();
    expect(classifyThread(thread(msg({ from: ME, to: "noreply@corp.com", labels: ["SENT"], ago: 4 * DAY })), me, ME, NOW)).toBeNull();
  });
});

describe("triage", () => {
  it("learns aliases from sent mail and sorts by score", () => {
    const alias = "jane.doe@example.edu";
    const threads = [
      thread(msg({ from: alias, to: "x@y.com", labels: ["SENT"], ago: 5 * DAY })),
      thread(msg({ from: "low@x.com", to: alias })),
      thread(msg({ from: "high@x.com", to: alias, labels: ["INBOX", "STARRED", "UNREAD"], snippet: "Are you free?" })),
    ];
    expect(collectMyAddresses(threads, ME, []).has(alias)).toBe(true);
    const { needsReply, waitingOn } = triage(threads, ME, [], NOW);
    expect(needsReply.map((t) => t.person.email)).toEqual(["high@x.com", "low@x.com"]);
    expect(waitingOn).toHaveLength(1);
  });
});

describe("parseBatch", () => {
  it("extracts JSON bodies from 2xx parts only", () => {
    const b = "batch_abc";
    const text = [
      `--${b}\r\nContent-Type: application/http\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"id":"a","messages":[]}\r\n`,
      `--${b}\r\nContent-Type: application/http\r\n\r\nHTTP/1.1 404 Not Found\r\n\r\n{"error":{}}\r\n`,
      `--${b}\r\nContent-Type: application/http\r\n\r\nHTTP/1.1 200 OK\r\n\r\n{"id":"c"}\r\n`,
      `--${b}--`,
    ].join("");
    expect(parseBatch<{ id: string }>(text, b).map((x) => x.id)).toEqual(["a", "c"]);
  });
});
