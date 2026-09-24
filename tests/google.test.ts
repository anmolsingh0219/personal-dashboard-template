import { describe, expect, it } from "vitest";
import type { Bindings } from "../worker/env";
import google from "../worker/routes/google";

const env = { GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "secret" } as Bindings;

describe("Google OAuth routes", () => {
  it("redirects to Google with offline access, all scopes and a state cookie", async () => {
    const res = await google.request("https://dash.example.com/connect", {}, env);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe("https://dash.example.com/api/google/callback");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(url.searchParams.get("scope")).toContain("auth/tasks");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`g_oauth_state=${url.searchParams.get("state")}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("rejects a callback whose state doesn't match the cookie", async () => {
    const res = await google.request("https://dash.example.com/callback?code=abc&state=forged", { headers: { cookie: "g_oauth_state=real" } }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?google=error&reason=state_mismatch");
  });

  it("passes through Google's error (e.g. a Workspace admin block)", async () => {
    const res = await google.request("https://dash.example.com/callback?error=access_denied", {}, env);
    expect(res.headers.get("location")).toBe("/?google=error&reason=access_denied");
  });
});
