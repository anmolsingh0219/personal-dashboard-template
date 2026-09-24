import { describe, expect, it } from "vitest";
import { parseBrief } from "../shared/brief";

const thread = (over: Record<string, unknown> = {}) => ({
  threadId: "1a0cb470f3b338aa",
  lastMessageId: "1a0cb470f3b338ab",
  subject: "Hi",
  person: { name: "Ann", email: "Ann@X.com" },
  snippet: "Can you meet?",
  date: 1_790_000_000_000,
  score: 7,
  reasons: ["Asks for a time"],
  ...over,
});

describe("parseBrief", () => {
  it("normalizes a valid brief and rebuilds Gmail links", () => {
    const b = parseBrief({ account: "Me@example.edu", needsReply: [thread({ url: "https://evil.example/phish", suggestedReply: "  Sure!  " })] }, 123);
    expect(b.generatedAt).toBe(123);
    expect(b.account).toBe("me@example.edu");
    expect(b.needsReply[0].person.email).toBe("ann@x.com");
    expect(b.needsReply[0].url).toBe("https://mail.google.com/mail/?authuser=me%40example.edu#all/1a0cb470f3b338aa");
    expect(b.needsReply[0].suggestedReply).toBe("Sure!");
    expect(b.waitingOn).toEqual([]);
  });

  it("rejects bad ids, non-emails and wrong types", () => {
    expect(() => parseBrief({ account: "nope" }, 1)).toThrow(/account/);
    expect(() => parseBrief({ account: "me@x.com", needsReply: [thread({ threadId: "../etc" })] }, 1)).toThrow(/Gmail id/);
    expect(() => parseBrief({ account: "me@x.com", needsReply: [thread({ date: "soon" })] }, 1)).toThrow(/date/);
    expect(() => parseBrief({ account: "me@x.com", needsReply: "all of them" }, 1)).toThrow(/array/);
  });

  it("caps sizes and drops non-https links", () => {
    const many = Array.from({ length: 60 }, () => thread());
    const b = parseBrief(
      {
        account: "me@x.com",
        needsReply: many,
        events: [{ id: "c:1", title: "x".repeat(500), start: 1, end: 2, htmlLink: "javascript:alert(1)", meetLink: "https://meet.google.com/abc" }],
      },
      1,
    );
    expect(b.needsReply).toHaveLength(40);
    expect(b.events[0].title).toHaveLength(200);
    expect(b.events[0].htmlLink).toBeNull();
    expect(b.events[0].meetLink).toBe("https://meet.google.com/abc");
  });

  it("requires all-day events to carry a date", () => {
    expect(() => parseBrief({ account: "me@x.com", events: [{ id: "c:1", start: 1, end: 2, allDay: true, day: "tomorrow" }] }, 1)).toThrow(/YYYY-MM-DD/);
  });

  it("accepts market rates and notes, dropping bad links and dates", () => {
    const b = parseBrief(
      {
        account: "me@x.com",
        markets: {
          rates: [{ name: "RBI repo rate", value: "5.50%", asOf: "2026-08-06", nextLabel: "Next MPC decision", nextDate: "2026-10-01", source: "http://insecure.example" }],
          summary: ["Oil slipped on US-Iran talk hopes", { text: "Gold near record", url: "https://example.com/gold" }],
        },
      },
      1,
    );
    expect(b.markets?.rates[0]).toEqual({ name: "RBI repo rate", value: "5.50%", asOf: "2026-08-06", nextLabel: "Next MPC decision", nextDate: "2026-10-01", source: null });
    expect(b.markets?.summary).toEqual([
      { text: "Oil slipped on US-Iran talk hopes", url: null },
      { text: "Gold near record", url: "https://example.com/gold" },
    ]);
    expect(() => parseBrief({ account: "me@x.com", markets: { rates: [{ name: "Fed", value: "4%", nextDate: "next week" }] } }, 1)).toThrow(/YYYY-MM-DD/);
    expect(parseBrief({ account: "me@x.com" }, 1).markets).toBeNull();
  });
});
