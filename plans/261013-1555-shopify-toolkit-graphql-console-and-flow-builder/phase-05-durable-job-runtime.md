---
phase: 5
title: "Phase 5: Durable Job Runtime"
status: todo
priority: P1
effort: "2d"
dependencies: [1]
---

# Phase 5: Durable Job Runtime

## Context Links

- Current provider and interface: `packages/jobs/src/index.ts` (`JobQueueProvider`, `createLocalJobProvider`, `getJobProviderStatus`)
- Scope-key rule: `/Volumes/anh.nguyen/Projects/AnhN/wizloft-boilerplate/docs/decisions/0017-scoped-job-and-integration-identity.md`
- API entrypoint: `apps/api/src/index.ts`; provider readiness: `packages/api/src/health.ts`
- pg-boss queue policies and options: https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md
- Known durability gap in the reference project: its import runner is in-process and documented as not restart-safe (`/Volumes/anh.nguyen/Projects/b8/project-evisu-oms-v2/docs/ARCHITECTURE.md`)

## Overview

Give the project a job runtime that survives restarts: a `pg-boss` provider behind the existing `JobQueueProvider` interface, a worker hosted in the API process, and throttle-aware Shopify request retry for background work.

## Key Insights

- `@repo/jobs` has only an in-memory provider whose status reports `mode: "ephemeral"`. Flow runs last minutes to hours, so they need persistence.
- pg-boss 12 requires Node 22.12+ and PostgreSQL 13+; this stack runs Node 24 and Postgres 17. It creates and migrates its own schema, separate from the tables Prisma manages.
- Queue policy `key_strict_fifo` gives FIFO per `singletonKey` with blocking per key, and `heartbeatSeconds` lets the monitor fail or retry a job whose worker stopped reporting. `expireInSeconds` caps active time at 86400.
- The `JobRun` and `JobLog` tables in the boilerplate are never written. They are left alone; pg-boss holds job state and flow runs get their own tables in phase 6.
- Shopify reports the cost bucket in every response (`extensions.cost.throttleStatus`), which is more reliable than a locally tracked estimate.

## Requirements

- `JOBS_PROVIDER=pgboss` selects the durable provider; `local` stays the default for unit tests.
- A job whose process dies is delivered again after its heartbeat lapses, without manual action.
- Jobs can be serialised per key so at most one runs for a given key at a time.
- Jobs can be enqueued with an idempotency key (within a scope key), a start delay, and a cron schedule.
- The API process starts workers when `JOBS_WORKER_ENABLED` is true and stops them gracefully on `SIGTERM` and `SIGINT`.
- Background Shopify requests wait and retry on `THROTTLED` instead of failing.

## Architecture

Interface additions in `packages/jobs/src/index.ts` (existing members unchanged):

```ts
interface JobDefinition {
  name: string;
  handler(payload, context: { runId: string; signal: AbortSignal }): Promise<void>;
  retry?: { attempts: number; delayMs: number };
  serialPerKey?: boolean;        // one active job per concurrencyKey
  heartbeatSeconds?: number;
  timeoutSeconds?: number;
}
interface EnqueueJobInput { /* existing */ concurrencyKey?: string; startAfterSeconds?: number }
interface JobQueueProvider {
  /* existing */
  start(): Promise<void>;
  stop(): Promise<void>;
  schedule(input: { name: string; key: string; cron: string; timezone?: string; payload: JobPayload }): Promise<void>;
  unschedule(name: string, key: string): Promise<void>;
}
```

Mapping in `providers/pg-boss.ts`: one queue per job name, created at `register`; `serialPerKey` selects policy `key_strict_fifo` with `singletonKey = concurrencyKey`; the idempotency key is combined with the scope key as today; `retry` maps to `retryLimit` and `retryDelay`; heartbeats are sent on an interval while the handler runs; `stop()` aborts the handler's signal and waits for it.

The local provider implements `start` and `stop` as no-ops and rejects `schedule` with a clear "not supported by the local provider" error.

Worker hosting: `packages/api/src/jobs.ts` exports `getJobProvider()` (singleton chosen by env) and `registerJobs(provider)`. `apps/api/src/index.ts` calls them after `assertApiProviderConfiguration()` and wires shutdown.

Throttle handling in `packages/shopify/src/admin/throttle.ts`, used by a new `requestWithRetry` on the store client:

```text
before request: if the last known bucket for this store, projected forward by restoreRate,
                is below the expected cost -> sleep until it is not
after response: remember throttleStatus for the store
on THROTTLED:   sleep (requestedCost - currentlyAvailable) / restoreRate, retry (bounded)
on 5xx/network: retry with backoff, at most 3 times
```

Bucket state is kept in memory per process. Cross-process contention is absorbed by the `THROTTLED` path.

## Related Code Files

- Create: `packages/jobs/src/keys.ts`, `packages/jobs/src/providers/pg-boss.ts`, `packages/jobs/src/providers/pg-boss.test.ts`, `packages/jobs/integration/pg-boss.integration.test.ts`
- Create: `packages/api/src/jobs.ts`, `packages/shopify/src/admin/throttle.ts`, `packages/shopify/src/admin/throttle.test.ts`
- Modify: `packages/jobs/src/index.ts`, `packages/jobs/src/index.test.ts`, `packages/jobs/package.json` (`pg-boss`, `@t3-oss/env-core`, `zod`; a real `test:integration` script)
- Modify: `packages/shopify/src/stores/store-client.ts`, `packages/api/src/health.ts`, `apps/api/src/index.ts`, `apps/api/env.ts`, `.env.example`, `.env.test.example`, `turbo.json`
- Modify: `docs/architecture.md`; create `docs/decisions/0004-durable-jobs-on-pg-boss.md`

## Implementation Steps

1. Read the installed pg-boss version's API docs for `createQueue`, `send`, `work`, `schedule`, queue policies and heartbeat. Note the exact option names before coding.
2. Extend the interface and update the local provider and its tests. Existing behaviour and tests must not change.
3. Add `keys.ts`: `JOBS_PROVIDER` (`local` | `pgboss`, default `local`), `JOBS_WORKER_ENABLED` (default true), reuse of `DATABASE_URL`. Register the names in `.env.example`, `.env.test.example`, `turbo.json` and `apps/api/env.ts`.
4. Implement the pg-boss provider as mapped above. Make `getJobProviderStatus()` report `provider: "pgboss"`, `mode: "durable"` when selected.
5. Write integration tests against Postgres: enqueue and complete; idempotency key deduplicates within a scope and not across scopes; failure retries then fails; two jobs with the same `concurrencyKey` never overlap while different keys do; a handler that never finishes is re-delivered to a second provider instance after an ungraceful stop; a cron schedule fires; `stop()` aborts the signal.
6. If the heartbeat test cannot be made to pass with pg-boss alone, add a lease on the job's domain row (owner and expiry, renewed while working, re-enqueued when expired) and record that in the decision document.
7. Add `packages/api/src/jobs.ts`, extend provider readiness in `health.ts` (production requires the durable provider), and start and stop the provider in `apps/api/src/index.ts`.
8. Implement `throttle.ts` and `requestWithRetry`, with fake-timer unit tests and one test against the fake Shopify server returning `THROTTLED` twice before succeeding.
9. Document local reset: `prisma migrate reset` does not drop the pg-boss schema; drop it explicitly when a clean queue is needed.
10. Write the decision record and update `docs/architecture.md`. Commit.

## Todo

- [x] pg-boss API confirmed against the installed version
- [x] Interface extended; local provider and tests updated
- [x] Env contract registered
- [x] pg-boss provider implemented
- [x] Integration tests green, including crash re-delivery and per-key serialisation
- [x] Provider wired into the API process with graceful shutdown
- [x] Throttle-aware retry on the store client with tests
- [x] Decision record and docs written; phase committed

## Success Criteria

- `pnpm --filter @repo/jobs test:integration` passes every case in step 5.
- With `JOBS_PROVIDER=pgboss`, `GET /status` reports the jobs provider as durable and configured; in production mode with the local provider the API refuses to start.
- Sending `SIGTERM` to the API while a test job runs lets the job observe the abort signal and exit; the job runs again on next start.
- `pnpm check:ci`, `pnpm check-types`, `pnpm test`, `pnpm boundaries` and `pnpm build` exit 0.

## Risk Assessment

- **Heartbeat or policy behaviour differs from the documentation read during planning.** Signal: the crash re-delivery or overlap test fails. Response: step 6, the pre-decided lease fallback. Flow correctness in phase 6 rests on item checkpoints, not on the queue alone.
- **pg-boss and Prisma share one database.** Signal: migration noise or connection pressure. Response: pg-boss stays in its own schema with its own small pool; cap its pool size in the provider options.
- **Worker in the API process competes with requests.** Signal: slow API responses during large runs. Response: moving the worker into its own app is a configuration change (`JOBS_WORKER_ENABLED=false` on the API, a second process with it true); no code depends on co-location.

## Security Considerations

- Job payloads are stored in Postgres in clear text. Handlers receive identifiers, never tokens or secrets.
- The provider uses the application's database credentials; no new credential is introduced.

## Next Steps

Phase 6 registers the `flow-run` job with `serialPerKey` keyed by store. Phase 9 uses `schedule` for cron triggers.
