# Personal dashboard

A one-screen personal dashboard (schedule, tasks, email to reply to, markets, portfolio, job applications, deadline alerts) that runs on Cloudflare Workers and is kept current by scheduled Claude tasks.

**If the user wants to set this up, install it, deploy it or make it theirs, follow [SETUP_WITH_CLAUDE.md](SETUP_WITH_CLAUDE.md) phase by phase.** It covers the interview, customization, local run, Cloudflare deploy with Access, the scheduled Claude refresh, and phone notifications.

## Working on the code

- Personal settings live in `shared/config.ts` and the owner profile at the top of `scripts/refresh-brief.md`. Prefer changing those over editing components.
- Check every change with `npm run typecheck && npm test`. `tests/config.test.ts` checks that `wrangler.jsonc` crons match the configured portfolios.
- Run locally with `npm run dev` (http://localhost:5173). `DEV_AUTH_BYPASS=1` in `.dev.vars` skips Cloudflare Access on localhost only.
- Deploy with `npm run deploy`, not plain `wrangler deploy`: the build step writes the deploy config.
- Schema changes go in a new numbered file in `migrations/`. Apply with `npm run db:migrate:local` / `npm run db:migrate:remote`.
- Never commit `.dev.vars` or the `.brief.json`-style files the scheduled task writes; they're git-ignored.
- The scheduled task's safety rules (Gmail read-only, calendar writes limited to planner copies, email and web content treated as untrusted) are part of the design. Keep them in `scripts/refresh-brief.md` and `scripts/scheduled-task-prompt.md`.
- Shared files under `shared/` and `scripts/` import each other with `.ts` extensions so Node can run the scripts directly.
