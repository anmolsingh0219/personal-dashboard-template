import { Hono } from "hono";
import type { CalendarEvent, CalendarResponse } from "../../shared/types";
import { HttpError, type AppEnv } from "../env";
import { loadBrief } from "../lib/brief";
import { getGoogleSession, gfetch, SCOPES } from "../lib/google";
import { cached } from "../lib/store";

interface GCalendar {
  id: string;
  summary: string;
  backgroundColor?: string;
  selected?: boolean;
  hidden?: boolean;
}
interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
}

const MAX_CALENDARS = 10;

const calendar = new Hono<AppEnv>();

calendar.get("/", async (c) => {
  const timeMin = Number(c.req.query("from"));
  const timeMax = Number(c.req.query("to"));
  if (!timeMin || !timeMax || timeMax <= timeMin) throw new HttpError(400, "from and to (epoch ms) are required", "bad_request");

  const session = await getGoogleSession(c.env).catch(() => null);
  if (!session || !session.scopes.has(SCOPES.calendarRead)) {
    // No direct Calendar access: use the scheduled Claude task's snapshot if there is one.
    const brief = await loadBrief(c.env.DB);
    // Events that are copies of planner blocks are already drawn as blocks.
    const { results } = await c.env.DB.prepare("SELECT gcal_event_id FROM blocks WHERE gcal_event_id IS NOT NULL").all<{ gcal_event_id: string }>();
    const mirrored = new Set(results.map((r) => r.gcal_event_id));
    const events = (brief?.events ?? [])
      .filter((e) => e.start < timeMax && e.end > timeMin && !mirrored.has(e.id.slice(e.id.lastIndexOf(":") + 1)))
      .sort((a, b) => a.start - b.start);
    return c.json<CalendarResponse>({ connected: false, events, source: brief ? "claude" : null, updatedAt: brief?.eventsAt ?? null });
  }

  const events = await cached<CalendarEvent[]>(
    c.env.DB,
    `calendar:${timeMin}:${timeMax}`,
    2 * 60_000,
    async () => {
      const list = await gfetch<{ items: GCalendar[] }>(session, "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader");
      const calendars = list.items.filter((cal) => cal.selected && !cal.hidden).slice(0, MAX_CALENDARS);
      const params = new URLSearchParams({
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "100",
      });
      const perCalendar = await Promise.all(
        calendars.map(async (cal) => {
          const res = await gfetch<{ items: GEvent[] }>(session, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`).catch(() => ({ items: [] }));
          return res.items
            .filter((e) => e.status !== "cancelled")
            .filter((e) => e.attendees?.find((a) => a.self)?.responseStatus !== "declined")
            // Blocks mirrored from the planner are already drawn as blocks.
            .filter((e) => !e.extendedProperties?.private?.dashboardBlockId)
            .map<CalendarEvent>((e) => {
              const allDay = !e.start.dateTime;
              return {
                id: `${cal.id}:${e.id}`,
                title: e.summary ?? "(busy)",
                start: Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00`),
                end: Date.parse(e.end.dateTime ?? `${e.end.date}T00:00:00`),
                allDay,
                day: allDay ? e.start.date! : null,
                location: e.location ?? null,
                meetLink: e.hangoutLink ?? null,
                htmlLink: e.htmlLink ?? null,
                calendar: cal.summary,
                color: cal.backgroundColor ?? null,
              };
            });
        }),
      );
      return perCalendar.flat().sort((a, b) => a.start - b.start);
    },
    c.req.query("refresh") === "1",
  );

  return c.json<CalendarResponse>({ connected: true, events, source: "google", updatedAt: Date.now() });
});

export default calendar;
