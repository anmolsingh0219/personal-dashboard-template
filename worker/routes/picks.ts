import { Hono } from "hono";
import type { PickVerdict, PicksResponse, ReadPick, SavedPick } from "../../shared/types";
import { HttpError, type AppEnv, type Bindings } from "../env";
import { cached, getSettings, invalidate } from "../lib/store";

// One thing to read per day — not a feed. Feedback ("read it", "not for me", "save") removes
// the item from future picks; your topics in Settings boost matching stories.

async function pickRead(env: Bindings): Promise<ReadPick | null> {
  const [fb, settings] = await Promise.all([
    env.DB.prepare("SELECT item_id FROM pick_feedback WHERE kind = 'read'").all<{ item_id: string }>(),
    getSettings(env.DB),
  ]);
  const excluded = new Set(fb.results.map((f) => f.item_id));
  const interests = settings.readInterests
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const res = await fetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40");
  if (!res.ok) throw new HttpError(502, `Hacker News error ${res.status}`);
  const { hits } = await res.json<{ hits: { objectID: string; title: string; url: string | null; points: number; num_comments: number }[] }>();
  const candidates = hits.filter((h) => !excluded.has(`hn:${h.objectID}`));
  if (candidates.length === 0) return null;

  const score = (h: (typeof hits)[number]) => h.points + 300 * interests.filter((k) => h.title.toLowerCase().includes(k)).length;
  const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));
  const discussionUrl = `https://news.ycombinator.com/item?id=${best.objectID}`;
  return {
    id: `hn:${best.objectID}`,
    title: best.title,
    url: best.url ?? discussionUrl,
    discussionUrl,
    source: best.url ? new URL(best.url).hostname.replace(/^www\./, "") : "news.ycombinator.com",
    points: best.points,
    comments: best.num_comments,
  };
}

const picks = new Hono<AppEnv>();

picks.get("/", async (c) => {
  const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
  const out: PicksResponse = { read: null, readNote: null };
  try {
    out.read = await cached(c.env.DB, `pick:read:${day}`, 24 * 3_600_000, () => pickRead(c.env));
    if (!out.read) out.readNote = "Nothing new on the front page.";
  } catch (e) {
    out.readNote = (e as Error).message;
  }
  return c.json(out);
});

picks.post("/feedback", async (c) => {
  const body = await c.req.json<{ itemId: string; verdict: PickVerdict; title: string; url?: string }>();
  if (!["save", "seen", "skip"].includes(body.verdict) || !body.itemId) throw new HttpError(400, "Bad feedback", "bad_request");
  await c.env.DB.prepare(
    "INSERT INTO pick_feedback (kind, item_id, verdict, title, meta, created_at) VALUES ('read', ?, ?, ?, ?, ?) ON CONFLICT(kind, item_id) DO UPDATE SET verdict = excluded.verdict, created_at = excluded.created_at",
  )
    .bind(body.itemId, body.verdict, body.title, JSON.stringify({ url: body.url ?? null }), Date.now())
    .run();
  await invalidate(c.env.DB, "pick:read:");
  return c.json({ ok: true });
});

picks.get("/saved", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT item_id, title, meta, created_at FROM pick_feedback WHERE kind = 'read' AND verdict = 'save' ORDER BY created_at DESC LIMIT 30").all<{
    item_id: string;
    title: string;
    meta: string | null;
    created_at: number;
  }>();
  return c.json<SavedPick[]>(
    results.map((r) => ({ itemId: r.item_id, title: r.title, url: (JSON.parse(r.meta ?? "{}") as { url?: string }).url ?? null, createdAt: r.created_at })),
  );
});

picks.delete("/saved/:itemId", async (c) => {
  // Removing from the saved list keeps it excluded from future picks.
  await c.env.DB.prepare("UPDATE pick_feedback SET verdict = 'seen' WHERE kind = 'read' AND item_id = ?").bind(c.req.param("itemId")).run();
  return c.json({ ok: true });
});

export default picks;
