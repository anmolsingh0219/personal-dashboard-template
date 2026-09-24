import { Hono } from "hono";
import { HOME_TZ } from "../../shared/config";
import { STAGES, type Application, type Stage } from "../../shared/types";
import { HttpError, newId, type AppEnv } from "../env";

/** Today's date where the owner lives (UTC would already be tomorrow on a US evening). */
const homeToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(new Date());

interface AppRow {
  id: string;
  company: string;
  role: string;
  stage: Stage;
  url: string | null;
  location: string | null;
  notes: string | null;
  applied_on: string | null;
  next_step: string | null;
  next_step_on: string | null;
  email_url: string | null;
  created_at: number;
  updated_at: number;
}

const toApp = (r: AppRow): Application => ({
  id: r.id,
  company: r.company,
  role: r.role,
  stage: r.stage,
  url: r.url,
  location: r.location,
  notes: r.notes,
  appliedOn: r.applied_on,
  nextStep: r.next_step,
  nextStepOn: r.next_step_on,
  emailUrl: r.email_url ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

type Input = Partial<Omit<Application, "id" | "createdAt" | "updatedAt" | "emailUrl">>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

function check(input: Input) {
  if (input.stage !== undefined && !STAGES.includes(input.stage)) throw new HttpError(400, "Unknown stage", "bad_request");
  for (const d of [input.appliedOn, input.nextStepOn]) if (d && !DATE.test(d)) throw new HttpError(400, "Dates must be YYYY-MM-DD", "bad_request");
  if (input.url && !/^https?:\/\//i.test(input.url)) throw new HttpError(400, "Link must start with http(s)://", "bad_request");
}

const jobs = new Hono<AppEnv>();

jobs.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM applications ORDER BY updated_at DESC").all<AppRow>();
  return c.json(results.map(toApp));
});

jobs.post("/", async (c) => {
  const input = await c.req.json<Input>();
  check(input);
  const company = clean(input.company);
  const role = clean(input.role);
  if (!company || !role) throw new HttpError(400, "Company and role are required", "bad_request");
  const stage = input.stage ?? "applied";
  const now = Date.now();
  const appliedOn = clean(input.appliedOn) ?? (stage === "saved" ? null : homeToday());
  const row: AppRow = {
    id: newId(),
    company,
    role,
    stage,
    url: clean(input.url),
    location: clean(input.location),
    notes: clean(input.notes),
    applied_on: appliedOn,
    next_step: clean(input.nextStep),
    next_step_on: clean(input.nextStepOn),
    email_url: null,
    created_at: now,
    updated_at: now,
  };
  await c.env.DB.prepare(
    "INSERT INTO applications (id, company, role, stage, url, location, notes, applied_on, next_step, next_step_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.company, row.role, row.stage, row.url, row.location, row.notes, row.applied_on, row.next_step, row.next_step_on, now, now)
    .run();
  return c.json(toApp(row));
});

jobs.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM applications WHERE id = ?").bind(id).first<AppRow>();
  if (!row) throw new HttpError(404, "Application not found", "not_found");
  const input = await c.req.json<Input>();
  check(input);

  const pick = (key: keyof Input, current: string | null) => (key in input ? clean(input[key] as string | null) : current);
  const stage = input.stage ?? row.stage;
  const next: AppRow = {
    ...row,
    company: clean(input.company) ?? row.company,
    role: clean(input.role) ?? row.role,
    stage,
    url: pick("url", row.url),
    location: pick("location", row.location),
    notes: pick("notes", row.notes),
    // Moving out of "saved" stamps the application date if it wasn't set.
    applied_on: pick("appliedOn", row.applied_on) ?? (row.stage === "saved" && stage !== "saved" ? homeToday() : null),
    next_step: pick("nextStep", row.next_step),
    next_step_on: pick("nextStepOn", row.next_step_on),
    updated_at: Date.now(),
  };
  await c.env.DB.prepare(
    "UPDATE applications SET company = ?, role = ?, stage = ?, url = ?, location = ?, notes = ?, applied_on = ?, next_step = ?, next_step_on = ?, updated_at = ? WHERE id = ?",
  )
    .bind(next.company, next.role, next.stage, next.url, next.location, next.notes, next.applied_on, next.next_step, next.next_step_on, next.updated_at, id)
    .run();
  return c.json(toApp(next));
});

jobs.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM applications WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default jobs;
