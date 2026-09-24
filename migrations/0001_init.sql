-- Key/value settings edited from the UI (mirror blocks to calendar, day start/end, ...).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Optional direct Google connection (single account). Tokens are AES-GCM encrypted with TOKEN_KEY.
CREATE TABLE google_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_expires_at INTEGER,
  scopes TEXT NOT NULL,
  connected_at INTEGER NOT NULL
);

-- Short-lived response cache (Gmail/Calendar/quotes/picks) so reloads stay cheap.
CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Tasks that live only in the dashboard (Google Tasks are fetched live when connected).
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  due TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Dashboard-only fields for any task, keyed 'local:<id>' or 'google:<listId>:<taskId>'.
CREATE TABLE task_meta (
  task_key TEXT PRIMARY KEY,
  estimate_min INTEGER
);

-- Time blocks on the day planner. Times are epoch milliseconds. A block needs copying to
-- Google Calendar (scripts/calendar-sync.ts) when it has no event yet or changed since its last sync.
CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  task_key TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  gcal_event_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER
);
CREATE INDEX blocks_start ON blocks(start_at);

-- Deleted blocks whose calendar copy still has to be removed.
CREATE TABLE calendar_tombstones (
  block_id TEXT PRIMARY KEY,
  gcal_event_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);

-- "Done"/"snooze" on the needs-reply list. A thread reappears when a newer message arrives.
CREATE TABLE email_dismissed (
  thread_id TEXT PRIMARY KEY,
  last_message_id TEXT NOT NULL,
  snooze_until INTEGER
);

-- Holdings, grouped into the portfolios defined in shared/config.ts.
CREATE TABLE holdings (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  shares REAL NOT NULL,
  cost_basis REAL,
  portfolio TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Daily value of each portfolio, saved by the cron after its market closes.
CREATE TABLE portfolio_snapshots (
  day TEXT NOT NULL,
  portfolio TEXT NOT NULL,
  value REAL NOT NULL,
  cost REAL NOT NULL,
  PRIMARY KEY (day, portfolio)
);

-- Trades and rebalances of a portfolio the owner follows, found in its emails by the scheduled
-- Claude task (scripts/push-portfolio.ts). id is stable per email line so re-runs don't duplicate.
CREATE TABLE portfolio_events (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  portfolio TEXT NOT NULL,
  action TEXT NOT NULL,
  symbol TEXT,
  detail TEXT,
  source TEXT NOT NULL,
  url TEXT,
  created_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX portfolio_events_time ON portfolio_events(occurred_at);

-- Job applications, added by hand or found in Gmail by the scheduled Claude task
-- (scripts/push-applications.ts), which keeps a link to the email that last updated them.
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  stage TEXT NOT NULL,
  url TEXT,
  location TEXT,
  notes TEXT,
  applied_on TEXT,
  next_step TEXT,
  next_step_on TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  email_thread_id TEXT,
  email_url TEXT,
  last_email_at INTEGER
);

-- Feedback on the daily reading pick ("save", "seen", "skip"); seen and skipped items aren't picked again.
CREATE TABLE pick_feedback (
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  title TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, item_id)
);

-- Data pushed in from outside the Worker: the scheduled Claude task's Gmail/Calendar/markets
-- snapshot (scripts/push-brief.ts). One row per kind.
CREATE TABLE imports (
  kind TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Browsers/phones that asked for deadline alerts (Web Push subscriptions).
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER
);

-- Alerts already sent, so a retried cron doesn't send them twice.
CREATE TABLE push_log (
  key TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
