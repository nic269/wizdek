---
phase: 3
title: "Phase 3: Data Model, Permissions and Services"
status: todo
priority: P1
effort: "2d"
dependencies: [2]
---

# Phase 3: Data Model, Permissions and Services

## Context Links

- Package to mirror: `packages/database-tools` (`package.json`, `src/index.ts`, `src/keys.ts`, `src/audit.ts`, `src/errors.ts`, `src/redact.ts`)
- Optimistic save and per-flow run numbers: `packages/flows/src/services/flows.ts`, `services/runs.ts`
- Test double pattern: `@repo/shopify/testing` (in-process fake server)
- Permissions: `packages/access-control/src/catalog.ts`, `roles.ts`, `access-control.test.ts`
- Import rules: `boundaries.config.json`
- Schema: `packages/database/prisma/schema.prisma`

## Overview

Add the tables, the `functions` permission module and a server-only `@repo/functions` package that stores functions and files, talks to the runner, and executes runs while streaming their output into the database.

## Key Insights

- `Function` collides with the JavaScript global type in generated Prisma code, so the models are named `CodeFunction*`.
- The Viewer preset is "every read permission except databases". Function source can contain hard-coded values, so `functions` must be excluded from it the same way.
- A run that executes in the API process is lost if that process stops. The agent still kills the container at its timeout; the API marks the orphaned row failed at startup, like `failInterruptedDatabaseBackups`.
- The supported parameter types are a closed set, so a small validator shared by the browser and the server is enough; no JSON Schema library is added.

## Requirements

- Tables for functions, files and runs, all reachable from an organization.
- `functions:read`, `functions:manage`, `functions:run` in the catalog; Owner and Admin get them through the catalog; Member and Viewer get none.
- `FUNCTIONS_RUNNER_URL` unset means the feature is off: reads work, and anything that needs the runner fails with a typed `FUNCTIONS_DISABLED` error. With `NODE_ENV=production` the URL must be `https`. `FUNCTIONS_RUNNER_TOKEN` is required when the URL is set.
- Saving files is atomic and takes the hash the editor loaded; a different stored hash is a conflict.
- After a save the entry file is inspected and the schema, or the inspector's error, is stored. If the runner is unreachable the previous schema is kept and flagged stale.
- A run stores its params, a snapshot hash of the source, output (flushed about every 500 ms, capped at 1 MB), result, status, exit code, duration and who started it.
- Runs beyond the newest 200 of a function are deleted when a run finishes.

## Architecture

```prisma
enum CodeFunctionRuntime { NODE PYTHON }
enum CodeFunctionRunStatus { QUEUED RUNNING SUCCEEDED FAILED TIMED_OUT CANCELED }
enum CodeFunctionRunTrigger { MANUAL HTTP SCHEDULE }

model CodeFunction {
  id, organizationId, name, description?, runtime,
  timeoutSeconds @default(60), memoryMb @default(256),
  sourceHash, paramsSchema Json?, paramsError?, paramsStale @default(false),
  createdById?, updatedById?, createdAt, updatedAt
  @@unique([organizationId, name])
}
model CodeFunctionFile {
  id, functionId, path, content @db.Text
  @@unique([functionId, path])
}
model CodeFunctionRun {
  id, functionId, organizationId, number, trigger, status,
  params Json, result Json?, output @db.Text, outputTruncated,
  exitCode?, error? @db.Text, durationMs?, sourceHash,
  cancelRequestedAt?, startedById?, createdAt, startedAt?, finishedAt?
  @@unique([functionId, number])
  @@index([functionId, createdAt])
  @@index([status, createdAt])
}
```

Package layout (`packages/functions`):

| Entry | Contents |
|-------|----------|
| `@repo/functions/definition` | Client-safe: limits, runtime ids and entry file names, path rules, starter templates, `validateParams(schema, params)` |
| `@repo/functions` | Server: `keys`, `runner/client.ts` (`FunctionRunner` interface and the HTTPS implementation), `services/functions.ts`, `services/runs.ts`, `services/execute.ts`, `audit.ts`, `errors.ts` |
| `@repo/functions/testing` | In-process fake runner that speaks the phase 2 protocol |

`FunctionRunner` has `health()`, `inspect()`, `run()` (an async iterator of events) and `cancel()`. It is the seam where another backend could be added later.

Execution (`execute.ts`):

1. Mark the row `RUNNING`, open the stream, register an `AbortController` under the run id.
2. Append output to a buffer; flush to the row on a 500 ms timer; stop appending at 1 MB and set `outputTruncated`.
3. On the `exit` event write status, exit code, result, error and duration; prune old runs.
4. A stream that breaks, a 429 or a 503 from the runner ends the run as `FAILED` with a plain reason.
5. `cancelRun` sets `cancelRequestedAt`, calls `runner.cancel` and aborts the controller. `abortAllRuns()` is called on shutdown.

`startRun` validates params with `validateParams`, assigns `number` under an advisory lock keyed on the function id, writes audit `function.run.started` for manual runs, and starts execution without awaiting it. It returns a promise of completion as well, for callers that want to wait.

Audit actions: `function.created`, `function.updated`, `function.deleted`, `function.files_saved`, `function.run.started`, `function.run.canceled`. Metadata never contains source or param values.

## Related Code Files

- Modify: `packages/database/prisma/schema.prisma`; create one migration
- Modify: `packages/access-control/src/catalog.ts`, `roles.ts`, `access-control.test.ts`
- Create: `packages/functions/package.json`, `tsconfig.json`, and the files in the layout above
- Create: unit tests for path rules, `validateParams` and the output buffer; `packages/functions/integration/functions.integration.test.ts`, `runs.integration.test.ts`
- Modify: `boundaries.config.json` (`@repo/functions` may import database, jobs, logger, security; `@repo/api` may import it; client-safe entry `./definition`)
- Modify: `Dockerfile` (`api-runner` install filter), `.env.example`, `turbo.json` (`FUNCTIONS_RUNNER_URL`, `FUNCTIONS_RUNNER_TOKEN`)

## Implementation Steps

1. Add the catalog entries, exclude `functions` from the Viewer preset, update the access-control test.
2. Add the models and create the migration with `pnpm db:migrate:dev` against the local database.
3. Create the package with `definition` first, then keys, errors and the runner client.
4. Write the fake runner; write `services/functions.ts` (create with the runtime's starter files, get, list, update settings, delete, `saveFiles`).
5. Write `services/runs.ts` and `services/execute.ts`, and `failInterruptedRuns(before)`.
6. Write the integration tests against the fake runner and a test database.
7. Update `boundaries.config.json` and run `pnpm boundaries`.

## Todo

- [ ] Catalog and presets
- [ ] Models and migration
- [ ] `definition` entry and validator
- [ ] Runner client and fake runner
- [ ] Function and file services
- [ ] Run, execute, cancel, prune, startup sweep
- [ ] Tests and boundaries

## Success Criteria

- Integration tests cover: create and reopen a function with several files; a stale hash is refused; a path with `..` or an oversized file is refused; a changed signature changes the stored schema; an inspector error is stored without losing the files.
- A run against the fake runner ends in each final status with the right fields; output over 1 MB is truncated; cancel reaches the runner; an unreachable runner yields `FAILED`, and an unset URL yields `FUNCTIONS_DISABLED`.
- The 201st run of a function deletes the oldest.
- No audit row contains source text or a param value.
- `pnpm boundaries`, `pnpm --filter @repo/functions test` and `check-types` pass.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Frequent output flushes load the database | One update per 500 ms per running run, and at most a handful of runs fit the runner's memory budget |
| Two saves race | The save runs in a transaction that compares `sourceHash` first |
| Existing organizations lack the new permissions | `pnpm db:sync-roles` is part of the deploy in phase 8 |

## Security Considerations

- The runner token is read only by `keys()` and sent only to the configured URL.
- Source and run output are organization data readable with `functions:read`; neither is logged.

## Next Steps

Phase 4 exposes these services through the API.
