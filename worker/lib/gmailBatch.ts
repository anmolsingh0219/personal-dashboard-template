import { HttpError } from "../env";
import type { GoogleSession } from "./google";

// Gmail batch endpoint: many GETs in one HTTP request. Keeps us far below the Workers
// free-plan limit of 50 outbound requests per invocation.

const BATCH_SIZE = 25;

export async function batchGet<T>(session: GoogleSession, paths: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    out.push(...(await runBatch<T>(session, paths.slice(i, i + BATCH_SIZE))));
  }
  return out;
}

async function runBatch<T>(session: GoogleSession, paths: string[]): Promise<T[]> {
  if (paths.length === 0) return [];
  const boundary = `batch_${crypto.randomUUID()}`;
  const body =
    paths
      .map((p, i) => `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <item${i}>\r\n\r\nGET ${p}\r\n`)
      .join("") + `--${boundary}--`;

  const res = await fetch("https://gmail.googleapis.com/batch/gmail/v1", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.token}`, "Content-Type": `multipart/mixed; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new HttpError(502, `Gmail batch failed (${res.status}).`);

  const resBoundary = res.headers.get("content-type")?.match(/boundary=("?)([^";]+)\1/)?.[2];
  if (!resBoundary) throw new HttpError(502, "Gmail batch response had no boundary.");
  return parseBatch<T>(await res.text(), resBoundary);
}

/** Parse a multipart/mixed batch response, keeping only 2xx JSON parts. */
export function parseBatch<T>(text: string, boundary: string): T[] {
  const out: T[] = [];
  for (const part of text.split(`--${boundary}`)) {
    const status = part.match(/HTTP\/1\.1 (\d{3})/);
    if (!status || !status[1].startsWith("2")) continue;
    const bodyStart = part.indexOf("{", status.index);
    const bodyEnd = part.lastIndexOf("}");
    if (bodyStart === -1 || bodyEnd < bodyStart) continue;
    try {
      out.push(JSON.parse(part.slice(bodyStart, bodyEnd + 1)) as T);
    } catch {}
  }
  return out;
}
