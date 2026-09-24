import type { Headline } from "../../shared/types";

// Minimal RSS 2.0 item parser (Workers have no DOMParser). Enough for news feeds:
// title, link and pubDate, with CDATA and common entities handled.

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();

const tag = (item: string, name: string) => item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1];

export function parseRss(xml: string, source: string): Headline[] {
  const out: Headline[] = [];
  for (const [, item] of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const title = decode(tag(item, "title") ?? "");
    const url = decode(tag(item, "link") ?? "");
    if (!title || !/^https:\/\//.test(url)) continue;
    const date = Date.parse(decode(tag(item, "pubDate") ?? tag(item, "dc:date") ?? ""));
    out.push({ title, url, source, publishedAt: Number.isNaN(date) ? null : date });
  }
  return out;
}
