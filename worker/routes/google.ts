import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { GoogleStatus } from "../../shared/types";
import type { AppEnv } from "../env";
import { invalidate } from "../lib/store";
import { assertConfigured, getGoogleSession, idTokenEmail, REQUESTED_SCOPES, saveGoogleAuth } from "../lib/google";

const STATE_COOKIE = "g_oauth_state";

const redirectUri = (url: string) => `${new URL(url).origin}/api/google/callback`;

const google = new Hono<AppEnv>();

google.get("/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT email, scopes FROM google_auth WHERE id = 1").first<{ email: string; scopes: string }>();
  const status: GoogleStatus = {
    configured: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    connected: Boolean(row),
    email: row?.email ?? null,
    scopes: row?.scopes.split(" ") ?? [],
  };
  return c.json(status);
});

google.get("/connect", (c) => {
  assertConfigured(c.env);
  const state = crypto.randomUUID();
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure, sameSite: "Lax", path: "/api/google", maxAge: 600 });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(c.req.url),
    response_type: "code",
    scope: REQUESTED_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  const hint = c.req.query("hint");
  if (hint) params.set("login_hint", hint);
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

google.get("/callback", async (c) => {
  const fail = (reason: string) => c.redirect(`/?google=error&reason=${encodeURIComponent(reason)}`);
  const { code, state, error } = c.req.query();
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/api/google" });

  if (error) return fail(error);
  if (!code || !state || state !== expected) return fail("state_mismatch");
  assertConfigured(c.env);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID!,
      client_secret: c.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(c.req.url),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return fail(`token_exchange_${res.status}`);
  const data = await res.json<{ access_token: string; refresh_token?: string; expires_in: number; scope: string; id_token?: string }>();
  if (!data.refresh_token) return fail("no_refresh_token");

  const email = data.id_token ? idTokenEmail(data.id_token) : "";
  await saveGoogleAuth(c.env, email, data.refresh_token, data.access_token, data.expires_in, data.scope);
  await invalidate(c.env.DB, "");
  return c.redirect("/?google=connected");
});

google.post("/disconnect", async (c) => {
  const session = await getGoogleSession(c.env).catch(() => null);
  if (session) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(session.token)}`, { method: "POST" }).catch(() => {});
  }
  await c.env.DB.prepare("DELETE FROM google_auth").run();
  await invalidate(c.env.DB, "");
  return c.json({ ok: true });
});

export default google;
