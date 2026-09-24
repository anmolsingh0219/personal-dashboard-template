import { HttpError, type Bindings } from "../env";
import { decrypt, encrypt } from "./crypto";

export const SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  calendarRead: "https://www.googleapis.com/auth/calendar.readonly",
  calendarWrite: "https://www.googleapis.com/auth/calendar.events",
  tasks: "https://www.googleapis.com/auth/tasks",
} as const;

export const REQUESTED_SCOPES = ["openid", "email", ...Object.values(SCOPES)];

interface AuthRow {
  email: string;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: number | null;
  scopes: string;
}

export interface GoogleSession {
  token: string;
  email: string;
  scopes: Set<string>;
}

export function assertConfigured(env: Bindings) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(503, "Google OAuth client is not configured.", "google_not_configured");
  }
}

export async function getGoogleSession(env: Bindings): Promise<GoogleSession | null> {
  const row = await env.DB.prepare("SELECT email, refresh_token, access_token, access_expires_at, scopes FROM google_auth WHERE id = 1").first<AuthRow>();
  if (!row) return null;
  const scopes = new Set(row.scopes.split(" "));

  if (row.access_token && (row.access_expires_at ?? 0) > Date.now() + 60_000) {
    return { token: await decrypt(env, row.access_token), email: row.email, scopes };
  }

  assertConfigured(env);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: await decrypt(env, row.refresh_token),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("invalid_grant")) {
      // Revoked, expired (OAuth app left in "Testing" = 7-day tokens), or password changed.
      await env.DB.prepare("DELETE FROM google_auth").run();
      throw new HttpError(409, "Google access expired or was revoked. Reconnect Google.", "google_not_connected");
    }
    throw new HttpError(502, `Google token refresh failed (${res.status}).`);
  }
  const data = await res.json<{ access_token: string; expires_in: number }>();
  await env.DB.prepare("UPDATE google_auth SET access_token = ?, access_expires_at = ? WHERE id = 1")
    .bind(await encrypt(env, data.access_token), Date.now() + data.expires_in * 1000)
    .run();
  return { token: data.access_token, email: row.email, scopes };
}

export async function requireGoogle(env: Bindings, scope?: string): Promise<GoogleSession> {
  const session = await getGoogleSession(env);
  if (!session) throw new HttpError(409, "Connect your Google account first.", "google_not_connected");
  if (scope && !session.scopes.has(scope)) {
    throw new HttpError(409, "This needs a Google permission you didn't grant. Reconnect Google and tick every box.", "scope_missing");
  }
  return session;
}

export async function gfetch<T>(session: GoogleSession, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${session.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let message = `Google API error ${res.status}`;
    try {
      const body = await res.json<{ error?: { message?: string } }>();
      if (body.error?.message) message = body.error.message;
    } catch {}
    throw new HttpError(res.status === 404 ? 404 : res.status === 403 ? 403 : 502, message);
  }
  return res.json<T>();
}

/** Decode (without verifying) an id_token received directly from Google's token endpoint over TLS. */
export function idTokenEmail(idToken: string): string {
  const payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return (JSON.parse(atob(payload)) as { email?: string }).email ?? "";
}

export async function saveGoogleAuth(env: Bindings, email: string, refreshToken: string, accessToken: string, expiresIn: number, scope: string) {
  await env.DB.prepare(
    `INSERT INTO google_auth (id, email, refresh_token, access_token, access_expires_at, scopes, connected_at)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token,
       access_token = excluded.access_token, access_expires_at = excluded.access_expires_at,
       scopes = excluded.scopes, connected_at = excluded.connected_at`,
  )
    .bind(email, await encrypt(env, refreshToken), await encrypt(env, accessToken), Date.now() + expiresIn * 1000, scope, Date.now())
    .run();
}
