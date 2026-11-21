---
phase: 7
title: "Phase 7: Triggers, Schedules and Env Vars"
status: completed
priority: P1
effort: "2d"
dependencies: [4, 5]
---

# Phase 7: Triggers, Schedules and Env Vars

## Context Links

- Session-less route with its own authentication: `packages/api/src/shopify-webhook-route.ts`, registration in `packages/api/src/app.ts`
- Hashed single-use secret: `ShopifyOAuthState.stateHash` and its service in `packages/shopify/src/oauth`
- Schedules: `packages/flows/src/engine/schedule-job.ts`, `packages/flows/src/services/activations.ts`, registration in `packages/api/src/jobs.ts`
- Encryption: `@repo/security/crypto` (`encryptSecret`, `decryptSecret`)
- Redaction: `packages/database-tools/src/redact.ts`
- Rewrite timeout: `apps/app/next.config.ts` (`experimental.proxyTimeout: 30_000`)

## Overview

Let a function be called from outside over HTTP with its own token, run on cron schedules, and read encrypted variables.

## Key Insights

- The Cloudflare tunnel hides the origin but does not authenticate callers. The trigger URL is public, so the token is the only thing that authorizes a run.
- The public origin reaches the API through the Next rewrite, whose proxy timeout is 30 seconds today. Cloudflare allows about 100 seconds. Waiting 90 seconds therefore needs `proxyTimeout` raised to 95 seconds.
- Variables make a function useful without putting API keys in params, which are stored with every run.
- A function can print its own variables. Scrubbing their values from stored output keeps them from people who can read runs but not manage the function.

## Requirements

Variables:

- Names match `^[A-Z_][A-Z0-9_]*$`; reserved names are refused: `PATH`, `HOME`, `NODE_OPTIONS`, `NODE_PATH`, `PYTHONPATH`, `PYTHONHOME`, anything starting with `LD_` or `FN_`.
- Values are encrypted with `encryptSecret`, decrypted only when a run starts, and never returned by any route; the API lists names only.
- Values of six characters or more are replaced with `[redacted]` in stored output, results and errors.

HTTP trigger:

- `POST /api/fn/{functionId}`; token in `x-function-token` or `Authorization: Bearer`. The JSON body is the params object; an empty body means no params.
- Enabling generates a token (32 random bytes, base64url, prefix `wfn_`) shown once. Only its SHA-256 and last four characters are stored. Rotate replaces it; disable clears it.
- Unknown function, disabled trigger, missing or wrong token: 401 with an empty body and no run. Comparison is constant-time.
- Body limit 1 MB (413). Invalid params: 422 with the issues. More than 60 requests a minute for one function: 429. Runner busy: 503 with `Retry-After`.
- The route waits up to 90 seconds: `SUCCEEDED` answers 200 `{ runId, status, result, durationMs }`; `FAILED` or `TIMED_OUT` answers 500 `{ runId, status, error }`; still running answers 202 `{ runId, status }`.
- `GET /api/fn/{functionId}/runs/{runId}` with the same token returns the run's status and result.
- The route is not behind the app-origin check and sets no cookies.

Schedules:

- Up to five per function: five-field cron, IANA time zone, params, enabled flag. The API contract validates the cron with `isCronExpression` from `@repo/flows/definition` (`packages/flows/src/definition/specs/trigger-schedule.ts`), so `@repo/functions` needs no import from `@repo/flows`.
- The public route passes the app's auth guard untouched: `apps/app/proxy.ts` matches page prefixes only, never `/api`.
- Enabling registers the schedule with the job provider under the schedule id; disabling or deleting removes it; both are safe to repeat.
- The job starts one run with trigger `SCHEDULE` and returns without waiting. A disabled or deleted schedule does nothing.

Audit: `function.env.set`, `function.env.deleted`, `function.http.enabled`, `function.http.rotated`, `function.http.disabled`, `function.schedule.created`, `function.schedule.updated`, `function.schedule.deleted`. Runs started by triggers are not audited individually; they appear in history.

## Architecture

```prisma
model CodeFunctionEnvVar   { id, functionId, name, valueEncrypted @db.Text  @@unique([functionId, name]) }
model CodeFunctionSchedule { id, functionId, cron, timezone, params Json, enabled, createdById?, createdAt, updatedAt }
// CodeFunction gains: httpEnabled, httpTokenHash? @unique, httpTokenHint?
// CodeFunctionRun gains: scheduleId?
```

Contract additions (all `manage` except reads):

| Route | Purpose |
|-------|---------|
| `GET/PUT/DELETE /api/functions/{functionId}/env[/{name}]` | List names, set, delete |
| `POST /api/functions/{functionId}/http/enable`, `/rotate`, `/disable` | Trigger lifecycle; enable and rotate return the token once |
| `GET/POST /api/functions/{functionId}/schedules`, `PATCH/DELETE /api/function-schedules/{scheduleId}` | Schedules |

The rate limiter is an in-memory sliding window per function id; the API runs as one process, and a restart resetting the window is acceptable.

## Related Code Files

- Modify: `packages/database/prisma/schema.prisma`; create one migration
- Create: `packages/functions/src/services/env-vars.ts`, `http-trigger.ts`, `schedules.ts`, `schedule-job.ts`, `rate-limit.ts`, `redact.ts`
- Modify: `packages/functions/src/services/execute.ts` (decrypt, pass, scrub), `services/runs.ts`, `audit.ts`, `index.ts`
- Create: `packages/api/src/function-trigger-route.ts`; modify `packages/api/src/app.ts` (register with its own body limit, before the oRPC handler)
- Modify: `packages/api/src/jobs.ts` (register the schedule job)
- Modify: `packages/api/src/contracts/functions.ts`, `routers/functions.ts`, `routers/authz.ts`
- Modify: `apps/app/next.config.ts` (`proxyTimeout: 95_000` and its comment)
- Create: `apps/app/app/functions/[functionId]/triggers-tab.tsx`, `variables-tab.tsx`; modify `side-panel.tsx`
- Create or extend tests: `packages/functions/integration/triggers.integration.test.ts`, `packages/api/integration/function-trigger.integration.test.ts`, `tests/e2e/functions.spec.ts`

## Implementation Steps

1. Add the models and fields; create the migration.
2. Write variables: service, routes, scrubbing in `execute.ts`, Variables tab.
3. Write the trigger service and the public route; register it; raise the rewrite timeout.
4. Write schedules: service, job, registration, routes.
5. Build the Triggers tab: enable with a one-time token dialog and a copyable `curl` example, rotate, disable; schedule list with the parameter form.
6. Write the tests.

## Todo

- [x] Models and migration
- [x] Variables end to end with scrubbing
- [x] Public trigger route, limiter, rewrite timeout
- [x] Schedules and job
- [x] Triggers and Variables tabs
- [x] Tests

## Success Criteria

- A variable's value is readable inside a run, appears in no API response, and is `[redacted]` in stored output when the function prints it.
- With the right token the trigger returns the function's result; with a wrong, missing or disabled token, or an unknown id, it returns 401 with an empty body and the run count is unchanged.
- A run that outlasts the wait returns 202, and the run-status route later returns its result (the test shortens the wait through an option).
- The 61st request in a minute gets 429; a 2 MB body gets 413; bad params get 422.
- A schedule set to every minute starts runs with trigger `SCHEDULE`; after disabling, no further run starts (tested with the local job provider, as the flow schedule tests do).
- Each lifecycle change writes its audit action; no audit row holds a token or a value.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Raising the rewrite timeout hides a slow API elsewhere | The console keeps its own 25-second limit; only the trigger route waits longer |
| Token guessing | 256-bit tokens, constant-time compare, uniform 401, rate limit |
| A schedule piles up runs of a slow function | The runner's memory budget refuses excess runs, which end as `FAILED` with "runner busy" |
| Traefik or the tunnel cuts long requests before 90 s | Measured in phase 9 with an 80-second function through the public URL; lower the wait if needed |

## Security Considerations

- The token is shown once and stored only as a hash. Logs record the function id and outcome, never the token, params or body.
- Trigger responses return `result` and `error` only, never stdout.
- Losing or changing `SHOPIFY_TOKEN_ENCRYPTION_KEY` makes variables unreadable, like every other stored secret.

## Outcome (2026-11-21)

Built as planned, with these differences:

- `CodeFunction` has no `httpEnabled` column: the trigger is on exactly while `httpTokenHash` is set, so the two can never disagree. The API reports `httpTrigger: { enabled, tokenHint }`.
- Output is scrubbed as it streams. The end of each piece that could start a secret is held back until the next piece, so a value split across two output events is still replaced. Results are scrubbed string by string (keys included), and errors as text.
- `WIZDEK_` is already a reserved variable prefix, so phase 8's runtime variables cannot collide with existing ones.
- Schedules are registered with the job provider inside the same transaction as the row. When the provider has no schedules (the in-memory `local` provider), the call fails with `SCHEDULES_UNAVAILABLE` (503) and nothing is saved. The job lives in `services/schedules.ts` and is not retried: a run that cannot start is logged.
- Deleting a function removes its schedules from the job provider first.
- The public route is a Hono sub-app mounted at `/api/fn`. `createApiApp({ functionTrigger: { waitMs } })` shortens the wait in tests. A run the runner refused for lack of room is recognized by its stored error and answered 503 with `Retry-After: 10`. The rate limit is checked after the token, so the limiter only holds keys of real functions.
- `/api/function-schedules/*` joined the app-origin check.
- The side panel gained Triggers and Variables tabs; its tab row uses less padding below the `xl` breakpoint so six tabs fit in 320 px.
- `packages/api/src/health.test.ts` now mocks the functions configuration check; it failed whenever a developer's `.env` set an http runner URL.

Verification: functions unit 14 and integration 34 (including a real pg-boss schedule firing), API 136 tests, functions e2e 6 against the fake runner, typecheck, lint and boundaries clean. The tabs were checked in the browser at 1280 and 1100 px.

## Next Steps

Phase 9 deploys and verifies everything on the real runner.
