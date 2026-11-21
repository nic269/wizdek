---
title: "Function triggers, schedules and encrypted variables"
date: 2026-11-21
summary: "Functions can now be called over HTTP with a per-function token, run on cron schedules, and read encrypted variables scrubbed from stored output."
---

# Function triggers, schedules and encrypted variables

## What happened
Implemented the triggers phase of the Functions runner plan, and added a built-in helpers phase (now phase 8; deploy moved to phase 9) after the owner chose the LAN path for the sandbox to reach wizdek-api.

- Variables: `CodeFunctionEnvVar` stores values with `encryptSecret`; the API lists names only. Values are decrypted when a run starts and passed to the runner over stdin. Stored output, results and errors are scrubbed. A streaming scrubber holds back the end of each output piece so a value split across two pieces is still caught.
- HTTP trigger: `POST /api/fn/{functionId}` as a Hono sub-app outside the app-origin check. The token is `wfn_` plus 32 random bytes, stored as SHA-256 with a four-character hint and compared in constant time. Every refusal is the same empty 401. The route has a 1 MB body limit, a 60/min limiter, a 90 s wait then 202, and 503 with Retry-After when the runner is full. Next `proxyTimeout` is now 95 s.
- Schedules: up to five per function, registered with pg-boss inside the row's transaction. The in-memory provider makes the call fail with `SCHEDULES_UNAVAILABLE` and saves nothing.

## Decisions
- Dropped the planned `httpEnabled` column; the token hash existing is the state.
- Reserved the `WIZDEK_` variable prefix now, ahead of the helpers phase.
- Fixed `health.test.ts`, which failed whenever `.env` held an http runner URL (an earlier phase's regression).

## Verification
Functions: 14 unit and 34 integration tests, including a real pg-boss firing. API: 136 tests. E2E: 6 functions specs. Typecheck, lint and boundaries pass.

## Next steps
Phase 8, the built-in `wizdek` SDK for databases and Shopify stores. Phases 1 and 9 still need owner approval for infrastructure.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
