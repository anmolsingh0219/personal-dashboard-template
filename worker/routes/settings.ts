import { Hono } from "hono";
import type { Settings } from "../../shared/types";
import type { AppEnv } from "../env";
import { getSettings, invalidate, saveSettings } from "../lib/store";

const settings = new Hono<AppEnv>();

settings.get("/", async (c) => c.json(await getSettings(c.env.DB)));

settings.put("/", async (c) => {
  const patch = await c.req.json<Partial<Settings>>();
  await saveSettings(c.env.DB, patch);
  if ("emailAliases" in patch) await invalidate(c.env.DB, "email:");
  if ("readInterests" in patch) await invalidate(c.env.DB, "pick:read:");
  return c.json(await getSettings(c.env.DB));
});

export default settings;
