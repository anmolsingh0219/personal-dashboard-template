import { parseBrief } from "../../shared/brief";
import type { Brief } from "../../shared/types";

/** The latest snapshot pushed by the scheduled Claude task, or null if there isn't a valid one. */
export async function loadBrief(db: D1Database): Promise<Brief | null> {
  const row = await db.prepare("SELECT data, updated_at FROM imports WHERE kind = 'brief'").first<{ data: string; updated_at: number }>();
  if (!row) return null;
  try {
    return parseBrief(JSON.parse(row.data), row.updated_at);
  } catch (e) {
    console.error("Stored brief is invalid:", (e as Error).message);
    return null;
  }
}
