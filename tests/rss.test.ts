import { describe, expect, it } from "vitest";
import { parseRss } from "../worker/lib/rss";

describe("parseRss", () => {
  it("reads items with CDATA, entities and dates, and skips non-https links", () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Feed</title>
      <item><title><![CDATA[Oil falls 2% as <b>US-Iran</b> talks resume]]></title><link>https://example.com/a</link><pubDate>Wed, 23 Sep 2026 08:10:00 GMT</pubDate></item>
      <item><title>S&amp;P 500 &#8211; record high</title><link>https://example.com/b</link></item>
      <item><title>Bad link</title><link>javascript:alert(1)</link></item>
    </channel></rss>`;
    expect(parseRss(xml, "Test")).toEqual([
      { title: "Oil falls 2% as US-Iran talks resume", url: "https://example.com/a", source: "Test", publishedAt: Date.parse("2026-09-23T08:10:00Z") },
      { title: "S&P 500 – record high", url: "https://example.com/b", source: "Test", publishedAt: null },
    ]);
  });
});

import { lastSession } from "../worker/lib/quotes";

describe("lastSession", () => {
  it("keeps only bars after the last overnight gap", () => {
    const bars = [0, 300, 600, 60_000, 60_300, 60_600].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1 }));
    expect(lastSession(bars, 3).map((b) => b.t)).toEqual([60_000, 60_300, 60_600]);
    // Only one bar into a new session: include the previous one too.
    const early = [0, 300, 600, 900, 90_000].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1 }));
    expect(lastSession(early, 3).map((b) => b.t)).toEqual([0, 300, 600, 900, 90_000]);
  });
});
