# Decision 0004: Durable jobs on pg-boss

- Status: accepted
- Date: 2026-10-14

## Context

Flow runs last from minutes to hours and must survive a restart. The boilerplate's `@repo/jobs` had only an in-memory provider, whose status honestly reports `mode: "ephemeral"`. The reference project's import runner is in-process and documented as not restart-safe, which is the gap this decision closes.

## Decision

Add a pg-boss provider behind the existing `JobQueueProvider` interface and run its worker inside the API process.

- `JOBS_PROVIDER=pgboss` selects it. `local` stays the default so unit tests need no database. In production the API refuses to start with the local provider.
- pg-boss stores jobs in the application's Postgres, in its own `pgboss` schema, with its own small connection pool. It creates and migrates that schema itself; Prisma does not manage it.
- The boilerplate's `JobRun` and `JobLog` tables stay unused. pg-boss holds job state, and flow runs get their own tables.

## How the interface maps to pg-boss

| Interface | pg-boss |
|-----------|---------|
| One job definition | One queue, plus a dead-letter queue named `<job>__dead` |
| `serialPerKey` with `concurrencyKey` | Queue policy `key_strict_fifo`, with the key as `singletonKey` |
| `idempotencyKey` within a `scopeKey` | A job id derived from scope, job name and key; sending an existing id is a no-op |
| `retry.attempts` and `retry.delayMs` | `retryLimit` (attempts minus one) and `retryDelay` |
| `heartbeatSeconds` | Queue `heartbeatSeconds`; `work()` sends the heartbeats |
| `timeoutSeconds` | `expireInSeconds`, capped at 24 hours |
| `startAfterSeconds` | `startAfter` |
| `schedule` and `unschedule` | `schedule` and `unschedule` with a `key`, so one job can have several schedules |
| `stop()` | A graceful stop: every running handler's signal aborts, then the provider waits for the handlers |

## What was verified

`packages/jobs/integration/pg-boss.integration.test.ts` runs against Postgres and covers: enqueue and completion; idempotency within a scope and not across scopes; retry then failure; no overlap for one concurrency key across two worker instances while different keys run in parallel; release of a key after a permanent failure; `stop()` aborting the signal and the job running again on the next start; re-delivery after the worker process is killed; and a cron schedule firing after a restart.

The crash test starts a separate worker process, lets it take a job, and kills it with `SIGKILL`. A second provider then receives the same job. pg-boss alone was enough, so the fallback considered during planning, a lease column on the domain row, was not needed.

## Behaviour to know about

**Recovery time after a crash.** A dead worker's job is delivered again once its heartbeat lapses and the queue monitor notices. With the defaults (`monitorIntervalSeconds` and `superviseIntervalSeconds` both 60) that took about 60 seconds for a 10-second heartbeat; with both set to 1 it took about 12 seconds. Both intervals must be lowered together to shorten it. The provider exposes them as options and leaves the defaults in place.

**A permanently failed job blocks its key.** Under `key_strict_fifo`, a job that has used all its retries keeps later jobs with the same key from running. For per-store flow runs that would stop a store's queue after one bad run. The provider therefore releases the key: when a handler fails on its final attempt, the job is failed (which copies it to the dead-letter queue) and then deleted, and a periodic sweep does the same for jobs failed by the monitor. The failed run stays readable through `getRun` from its dead-letter copy.

**A graceful stop uses a retry.** Stopping the provider fails the running attempt so the job is retried on the next start. Jobs that should survive several deploys need a retry budget to match.

**Schedules fire at most once a minute**, within about a minute of the cron time. They are stored in Postgres and resume after a restart.

**Idempotency lasts as long as the job row.** pg-boss deletes completed jobs after seven days by default, after which the same key creates a new job.

**Job payloads are stored in clear text.** Handlers receive identifiers, never tokens or secrets.

## Consequences

- The worker shares the API process, so heavy runs compete with requests. Moving it out is configuration only: run a second API process with `JOBS_WORKER_ENABLED=true` and set it to `false` on the one serving requests. No code depends on co-location.
- `prisma migrate reset` does not touch the `pgboss` schema. For a clean queue locally, run `DROP SCHEMA pgboss CASCADE;` against the database; pg-boss recreates it on the next start.
- Testing a worker crash needs a real second process. The test launches it as a single Node process, because killing a package-manager wrapper leaves the actual worker alive and heartbeating.
