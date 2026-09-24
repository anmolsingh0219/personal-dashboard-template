import { Hono } from "hono";
import { PORTFOLIO_IDS, PORTFOLIOS } from "../shared/config";
import { requireAccess } from "./auth";
import { HttpError, type AppEnv, type Bindings } from "./env";
import blocks from "./routes/blocks";
import calendar from "./routes/calendar";
import email from "./routes/email";
import google from "./routes/google";
import jobs from "./routes/jobs";
import markets from "./routes/markets";
import picks from "./routes/picks";
import portfolio from "./routes/portfolio";
import push, { sendDeadlineAlerts } from "./routes/push";
import settings from "./routes/settings";
import stocks, { snapshotPortfolio } from "./routes/stocks";
import tasks from "./routes/tasks";



const app = new Hono<AppEnv>().basePath("/api");

app.use("*", requireAccess);
app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

app.get("/me", (c) => c.json({ email: c.get("userEmail") }));
app.route("/google", google);
app.route("/email", email);
app.route("/calendar", calendar);
app.route("/tasks", tasks);
app.route("/blocks", blocks);
app.route("/settings", settings);
app.route("/stocks", stocks);
app.route("/jobs", jobs);
app.route("/markets", markets);
app.route("/picks", picks);
app.route("/portfolio", portfolio);
app.route("/push", push);

app.notFound((c) => c.json({ error: "Not found", code: "not_found" }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, code: err.code }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: "Request body must be valid JSON", code: "bad_request" }, 400);
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    // Each portfolio's snapshot cron (shared/config.ts) runs after its market closes; the hourly one sends deadline alerts.
    const closing = PORTFOLIO_IDS.filter((p) => PORTFOLIOS[p].snapshotCron === controller.cron);
    if (closing.length) ctx.waitUntil(Promise.all(closing.map((p) => snapshotPortfolio(env, p))));
    else ctx.waitUntil(sendDeadlineAlerts(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Bindings>;
