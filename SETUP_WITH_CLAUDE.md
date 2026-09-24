# Set up this dashboard (instructions for Claude)

You're helping someone set up their own copy of this personal dashboard: a one-screen view of their schedule, tasks, email that needs a reply, markets, stock portfolio, job applications and deadlines, hosted free on Cloudflare and kept current by scheduled Claude tasks. Work through the phases below in order. The person may not be a developer. Explain what each step does in a sentence, do the work yourself where you can, and give exact clicks where they have to act in a browser.

## Ground rules

- **Ask before anything outward-facing:** creating resources in their Cloudflare or GitHub account, creating scheduled tasks, or adding calendar events. One confirmation per action.
- **Secrets never go in chat, git or command lines.** `.dev.vars` holds them locally (git-ignored). Upload them with `wrangler secret put`, reading from the file (commands below), never by echoing values.
- Their copy will contain personal configuration. If they push it to GitHub, make the repo **private**.
- After any code or config change, run `npm run typecheck && npm test`. Both must pass before you move on.
- Deploy with `npm run deploy`, never plain `wrangler deploy`. The Vite build writes the deploy config, and a stale build deploys stale settings.
- Cloudflare's API sometimes fails with `code: 7403` ("account is not valid or is not authorized"). It's transient: wait a few seconds and retry the same command.

## Phase 1: Interview

Ask these in one go (use a multiple-choice question tool if you have one). Offer the default in brackets so they can just accept.

1. **First name** (signs suggested email replies) and **home time zone** [ask their city; convert it to an IANA zone like `America/New_York`].
2. **Which Google account holds their email and calendar?** A personal Gmail, or a school or work Google Workspace account. [The scheduled Claude tasks read it through Claude's Gmail and Google Calendar connectors, with no Google Cloud project needed.]
3. **Stock portfolios:** which markets do they hold stocks in? [US only.] For each, which broker, and do they want to enter holdings by hand? Holdings are always entered by hand in the dashboard.
4. **Markets panel:** which indices, commodities or currencies should be tiles? [S&P 500, Nasdaq, WTI, Brent, gold.] Which central-bank rates matter to them? [Fed funds.] Any news sources they prefer? [CNBC.]
5. **Job search:** are they tracking job applications? [Yes: the tracker fills itself from application emails.]
6. **A portfolio to watch:** do they copy or follow a portfolio that emails its trades, such as one on Autopilot or a newsletter's model portfolio? [No.]
7. **Refresh times** for the scheduled Claude task that reads email, calendar and markets. [9:30 AM, 1 PM and 5 PM.]
8. **Deadline alerts on their phone** (7 PM the day before and 8 AM on the day)? [Yes.] Which phone? (iPhone needs iOS 16.4+.)
9. **Topics for the daily reading pick** (Hacker News). [Skip; they can set it later in Settings.]

## Phase 2: Customize

Everything personal is in two files. Edit them from the answers.

### `shared/config.ts`

- `HOME_TZ`: their time zone.
- `PORTFOLIOS`: keep one entry per market they hold. Delete `india` if they don't hold Indian stocks; the portfolio switch disappears with one portfolio. To add a market, copy an entry and fill in the exchange's session and Yahoo Finance suffix:

  | Market | suffixes | currency / locale | tz | open–close | snapshotCron (UTC) |
  |---|---|---|---|---|---|
  | US (NYSE/Nasdaq) | none | USD / en-US | America/New_York | 9:30–16:00 | `15 21 * * 1-5` |
  | India (NSE/BSE) | `.NS`, `.BO` | INR / en-IN | Asia/Kolkata | 9:15–15:30 | `15 10 * * 1-5` |
  | UK (LSE) | `.L` | GBP / en-GB | Europe/London | 8:00–16:30 | `45 16 * * 1-5` |
  | Canada (TSX) | `.TO` | CAD / en-CA | America/Toronto | 9:30–16:00 | `15 21 * * 1-5` |
  | Germany (Xetra) | `.DE` | EUR / de-DE | Europe/Berlin | 9:00–17:30 | `45 16 * * 1-5` |
  | Japan (TSE) | `.T` | JPY / ja-JP | Asia/Tokyo | 9:00–15:30 | `45 6 * * 1-5` |
  | Hong Kong (HKEX) | `.HK` | HKD / en-HK | Asia/Hong_Kong | 9:30–16:00 | `15 8 * * 1-5` |
  | Australia (ASX) | `.AX` | AUD / en-AU | Australia/Sydney | 10:00–16:00 | `15 6 * * 1-5` |

  Pick a `snapshotCron` that falls after the close in both summer and winter time; UTC doesn't shift with daylight saving. Markets that close at the same UTC time can share a cron.
- `MARKET_TILES`: Yahoo Finance symbols (`^GSPC`, `^FTSE`, `^N225`, `EURUSD=X`, `BTC-USD`, `GC=F`…). Keep it to about 6–8 tiles.
- `NEWS_FEEDS`: RSS URLs for the headlines list. Check each one returns items (`curl -sL <url> | head`).

### `wrangler.jsonc`

- `triggers.crons`: exactly the `snapshotCron` of each portfolio (no duplicates) plus `"5 * * * *"` for deadline alerts. The free plan allows 5 crons per account. `tests/config.test.ts` fails if these drift from the config.
- Leave `database_id`, `ACCESS_*` and `VAPID_*` for later phases.

### `scripts/refresh-brief.md` (what the scheduled Claude task does)

Fill in the **Owner profile** at the top: replace `{{OWNER_NAME}}` and `{{OWNER_TIMEZONE}}`, and set the policy rates, markets and sources. For the portfolio to watch, either leave "none", or name the portfolio and who emails about it; step 6 builds its Gmail search from that. If they aren't job hunting, add "Skip step 5." to the profile. `grep -n "{{" scripts/refresh-brief.md` must print nothing when you're done.

### Optional

- **Panels they don't want:** remove the component from `src/App.tsx`, and its stat and entries from `src/components/NowStrip.tsx` and `src/components/CommandPalette.tsx`. The API routes can stay.
- **Chart event markers** (`shared/marketEvents.ts`): market-moving events since 2020, drawn on the charts by region (global, US, India). Add a region and events if they follow another market; `regionFor()` maps symbols to regions.

Then run `npm run typecheck && npm test`.

## Phase 3: Run it locally

1. `node -v` must be **22.18 or newer**; the scripts run TypeScript directly. If it's older, have them install the current LTS from nodejs.org.
2. `npm install`
3. `npm run setup`: creates `.dev.vars`, generates the encryption and push-notification keys, and sets up the local database.
4. `npm run dev`, then open http://localhost:5173 (use a browser preview tool if you have one). Locally, `DEV_AUTH_BYPASS=1` skips the login.
5. Show them around: add a holding in the Portfolio panel, add a task (`Problem set ~90m @fri` sets a 90-minute estimate due Friday), drag it onto the schedule, and open a market tile's chart.

## Phase 4: Deploy to Cloudflare (free plan)

Confirm before creating anything. Do the commands yourself; the person does the browser steps.

1. **Account.** They sign up at https://dash.cloudflare.com/sign-up and **verify their email**; deploys fail until it's verified.
2. **Log in:** `npx wrangler login` opens a browser to approve access. Check with `npx wrangler whoami`.
3. **workers.dev subdomain.** New accounts need one. They open **Workers & Pages** in the dashboard and pick a subdomain when asked (e.g. their name). The site will live at `https://dashboard.<subdomain>.workers.dev`.
4. **Database:** `npx wrangler d1 create dashboard`. Copy the printed `database_id` into `wrangler.jsonc`.
5. **Tables:** `npm run db:migrate:remote` (answer `y`).
6. **First deploy:** `npm run deploy`. Note the URL it prints.
7. **Push contact URL:** `npm run setup -- --url https://dashboard.<subdomain>.workers.dev`
8. **Secrets**, read straight from `.dev.vars` so they never appear on screen:
   ```bash
   grep '^TOKEN_KEY=' .dev.vars | cut -d= -f2- | npx wrangler secret put TOKEN_KEY
   grep '^VAPID_PRIVATE_KEY=' .dev.vars | cut -d= -f2- | npx wrangler secret put VAPID_PRIVATE_KEY
   ```
9. **Lock it down with Cloudflare Access** (free for up to 50 users). Until this is done the API answers every request with *503 Cloudflare Access is not configured*. That's deliberate: the page shows their inbox and portfolio.
   1. Cloudflare dashboard → **Workers & Pages** → **dashboard** → **Settings** → **Domains & Routes**. Next to the *workers.dev* route, open the menu and choose **Enable Cloudflare Access**.
   2. It creates an Access application. Open **Manage Cloudflare Access** (or **Zero Trust → Access → Applications**) and edit the app's policy so only their email address is allowed (Action: Allow; Include: Emails → their address). They log in with a one-time code sent to that email.
   3. Copy the application's **Application Audience (AUD) Tag** (on the app's overview or Basic information tab).
   4. Their **team domain** is under **Zero Trust → Settings** (`<team>.cloudflareaccess.com`). A first visit to Zero Trust may ask them to choose a team name and the free plan; the free plan needs no payment method for up to 50 users.
   5. Put both values in `wrangler.jsonc` as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, then run `npm run deploy`.
10. **Check it:**
    - `curl -s -o /dev/null -w "%{http_code}\n" https://dashboard.<subdomain>.workers.dev/api/me` should print `302`, a redirect to the Access login. `200` would mean it's open to the world; stop and fix Access.
    - They open the URL, log in with the emailed code, and see the dashboard.

**Troubleshooting**

| Symptom | Fix |
|---|---|
| `code: 7403` from wrangler | Transient. Retry. |
| "You need to verify your email" | Verify the Cloudflare account email, then retry. |
| "You need a workers.dev subdomain" | Step 3. |
| Page loads but panels say *Cloudflare Access is not configured* | Step 9.5 not deployed yet. |
| Panels say *401* / invalid token | `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN` doesn't match the Access app. |
| A deploy seems to ignore config changes | Use `npm run deploy` (it rebuilds first). |

## Phase 5: Daily refresh by Claude (email, calendar, markets)

The Email, Schedule and Markets-notes panels are filled by a scheduled Claude task that runs on their computer: it reads Gmail and Google Calendar through Claude's connectors, looks up rates and market news, and saves a snapshot to their dashboard's database. It's read-only for email, and the only calendar changes it makes are copies of the time blocks they plan on the dashboard.

1. **Requirements:** Claude Desktop (Mac or Windows) signed in, with the **Gmail** and **Google Calendar** connectors connected to the account from question 2 (Claude → Settings → Connectors). The computer must be awake with Claude running at refresh time; a missed run happens once when it wakes. Wrangler must stay logged in (`npx wrangler whoami`), because the push scripts write to the database through it.
2. **Create the tasks.** The prompt is `scripts/scheduled-task-prompt.md` with `{{DASHBOARD_DIR}}` replaced by the absolute path of this folder. If you have a scheduled-task tool (such as `create_scheduled_task`), create them yourself after confirming. Otherwise have them use Claude Desktop → **Scheduled** → **New task**, pointed at this folder.
   - Default: one task at 9:30 AM and one at 1 PM and 5 PM. Runs start a few minutes late on purpose, so schedule them about 5–10 minutes early (e.g. cron `25 9 * * *` and `55 12,16 * * *`).
3. **First run with them watching.** Start one run now ("Run now"). The first time it uses each tool (Gmail, Calendar, web search, the `node scripts/…` commands) Claude Desktop asks for permission in that run's session. They should choose **Always allow**, not "Allow once", or the next unattended run stops at the same prompt. A run stuck on a prompt also blocks that task's later runs.
4. **Check it:** the run ends with lines like `Brief updated (remote): …`, and the dashboard's Email and Schedule panels show "via Claude · <time>".

## Phase 6: Phone

1. On the phone, open the dashboard URL in **Safari** (iPhone) or Chrome (Android) and log in.
2. iPhone: **Share → Add to Home Screen**, then open it from the new icon. The home-screen app has its own login, so they sign in with the emailed code once more.
3. In the app: **Settings (gear) → Deadline alerts → Turn on for this device** and allow notifications. A test notification arrives within seconds. If it doesn't, the Settings panel says why.

Alerts cover tasks with a due date and job-application next steps: 7 PM the day before and 8 AM on the day, in `HOME_TZ`.

## Phase 7: Their own repository (optional)

1. Check `git remote -v`.
   - If it points to **their own private repo** (they used "Use this template" or `gh repo create --template … --private --clone`), commit and push their changes.
   - If it points to the **public template**, give their copy its own private home. Confirm a name, then:
     ```bash
     git remote remove origin
     gh repo create <name> --private --source . --push
     ```
   Before any push, check that `git status` doesn't list `.dev.vars` or any `.brief.json`-style files; `.gitignore` covers them.
2. Optional auto-deploy: Cloudflare → **Workers & Pages → dashboard → Settings → Build → Connect** the repo. Build command `npm run build`, deploy command `npx wrangler deploy`.

## Finish

Summarize for them: their URL, how they log in, what refreshes when, how to add holdings and tasks, and where to change things later (`shared/config.ts`, `scripts/refresh-brief.md`, Settings in the app).

## Reference: where things live

| Path | What it is |
|---|---|
| `shared/config.ts` | Personal settings: time zone, portfolios, market tiles, news feeds |
| `scripts/refresh-brief.md` | What the scheduled Claude task does, with the owner profile at the top |
| `scripts/scheduled-task-prompt.md` | Prompt for the scheduled tasks |
| `scripts/setup.ts` | `npm run setup`: local keys and database |
| `scripts/push-*.ts`, `scripts/calendar-sync.ts` | Scripts the scheduled task runs to save data (validated before writing) |
| `wrangler.jsonc` | Cloudflare Worker config: database, crons, Access and push settings |
| `worker/` | API (Hono on Cloudflare Workers): `routes/`, `lib/` |
| `src/` | React app: `components/` (one per panel), `lib/` |
| `migrations/` | D1 (SQLite) schema |
| `tests/` | Vitest tests, including config checks |
