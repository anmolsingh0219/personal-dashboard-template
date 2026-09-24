import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requireAccess } from "../worker/auth";
import type { AppEnv, Bindings } from "../worker/env";

const app = new Hono<AppEnv>().use("*", requireAccess).get("/api/ping", (c) => c.json({ ok: true, user: c.get("userEmail") }));
const env = (vars: Partial<Bindings>) => vars as Bindings;

describe("requireAccess", () => {
  it("lets localhost through only when the dev bypass is on", async () => {
    expect((await app.request("http://localhost:5173/api/ping", {}, env({ DEV_AUTH_BYPASS: "1" }))).status).toBe(200);
    expect((await app.request("http://localhost:5173/api/ping", {}, env({}))).status).toBe(503);
  });

  it("ignores the dev bypass on a real hostname and fails closed when Access isn't configured", async () => {
    const res = await app.request("https://dashboard.example.workers.dev/api/ping", {}, env({ DEV_AUTH_BYPASS: "1" }));
    expect(res.status).toBe(503);
  });

  it("rejects missing or malformed Access tokens", async () => {
    const vars = env({ ACCESS_TEAM_DOMAIN: "myteam", ACCESS_AUD: "aud123" });
    expect((await app.request("https://dash.example.com/api/ping", {}, vars)).status).toBe(401);
    const bad = await app.request("https://dash.example.com/api/ping", { headers: { "cf-access-jwt-assertion": "not-a-jwt" } }, vars);
    expect(bad.status).toBe(401);
  });
});
