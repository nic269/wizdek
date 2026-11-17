---
phase: 4
title: "Phase 4: API Contracts and Routers"
status: completed
priority: P1
effort: "1d"
dependencies: [3]
---

# Phase 4: API Contracts and Routers

## Context Links

- Contract and router to mirror: `packages/api/src/contracts/databases.ts`, `routers/databases.ts`, `routers/database-errors.ts`
- Record-scoped authorization: `requireStorePermission` and its siblings in `packages/api/src/routers/authz.ts`
- Route registration and origin checks: `packages/api/src/app.ts`, `routers/index.ts`, `contracts/index.ts`
- Startup and shutdown: `apps/api/src/index.ts`, `packages/api/src/jobs.ts`
- Integration test helpers: `packages/api/integration/support.ts`, `databases.integration.test.ts`

## Overview

Expose functions, files and runs through contract-first oRPC routes with the same authorization shape as stores, flows and databases.

## Requirements

- Organization-scoped routes take the organization from the path; record-scoped routes derive it from the function or run row, never from input.
- A caller outside the organization gets 404; a member without the permission gets 403.
- Writes pass `requireAppOrigin`.
- No response contains the runner token or URL.
- Reading a run accepts `outputOffset` and returns only the output after it, so polling a long run does not resend what the client already has.
- At startup the API fails runs left `QUEUED` or `RUNNING`; on shutdown it aborts running ones.

## Architecture

| Route | Permission | Purpose |
|-------|-----------|---------|
| `GET /api/organizations/{organizationId}/functions` | read | List |
| `POST /api/organizations/{organizationId}/functions` | manage | Create (name, runtime) |
| `GET /api/organizations/{organizationId}/functions/status` | read | `{ enabled, reachable, runtimes }` |
| `GET /api/functions/{functionId}` | read | Function with files and params schema |
| `PATCH /api/functions/{functionId}` | manage | Name, description, timeout, memory |
| `DELETE /api/functions/{functionId}` | manage | Delete with files and runs |
| `PUT /api/functions/{functionId}/files` | manage | Replace files; takes `baseHash`; 409 on conflict |
| `GET /api/functions/{functionId}/runs` | read | Page of runs, newest first |
| `POST /api/functions/{functionId}/runs` | run | Start a manual run with params |
| `GET /api/function-runs/{runId}` | read | Run with output and result |
| `POST /api/function-runs/{runId}/cancel` | run | Cancel |

Error mapping (`routers/function-errors.ts`): `FUNCTIONS_DISABLED` to 409 with that code, validation problems to 422, conflicts to 409, runner busy to 503.

## Related Code Files

- Create: `packages/api/src/contracts/functions.ts`, `routers/functions.ts`, `routers/function-errors.ts`
- Modify: `packages/api/src/contracts/index.ts`, `routers/index.ts`
- Modify: `packages/api/src/routers/authz.ts` (`requireFunctionPermission`, `requireFunctionRunPermission`)
- Modify: `packages/api/src/app.ts` (origin check for `/api/functions/*`, `/api/function-runs/*`, `/api/organizations/:organizationId/functions` and its children)
- Modify: `packages/api/src/jobs.ts` (`failInterruptedFunctionRuns`), `apps/api/src/index.ts` (call it at startup; call `abortAllRuns` in shutdown)
- Modify: `packages/api/src/openapi.test.ts` if it lists routes
- Create: `packages/api/integration/functions.integration.test.ts`

## Implementation Steps

1. Write the contract with zod schemas; reuse the limits from `@repo/functions/definition`.
2. Add the two authorization helpers beside the existing ones.
3. Write the router as thin calls into `@repo/functions`.
4. Register routes and origin checks; wire the startup sweep and shutdown abort.
5. Write the integration tests with the fake runner.

## Todo

- [x] Contract
- [x] Authorization helpers
- [x] Router and error mapping
- [x] Registration, sweep and shutdown
- [x] Integration tests

## Success Criteria

- Owner and Admin can do everything; Member and Viewer get 403 on every route; a user from another organization gets 404.
- With the runner URL unset, `status` answers `enabled: false`, list and get still work, and starting a run answers 409 `FUNCTIONS_DISABLED`.
- A full cycle works against the fake runner: create, save files, start a run, poll to completion, cancel another.
- A write from a foreign origin is refused.
- `pnpm --filter @repo/api test` and `check-types` pass.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| A new path is missed by the origin check | The integration test sends each write with a foreign origin |
| Polling returns a large output repeatedly | The run route accepts `outputOffset` and returns only the tail the client lacks |

## Security Considerations

- Run params and results are returned only to callers with `functions:read` in the run's organization.

## Implementation Notes

- Errors keep the shared contract codes; the functions failure is in `error.details.reason` (e.g. `CONFLICT` with reason `FUNCTIONS_DISABLED`), like the database routes.
- `outputOffset` and `outputLength` count JavaScript string length, so the browser can append the tail it receives directly.
- An outsider gets 404 on record routes and 403 on organization routes, matching the other modules.
- `assertApiProviderConfiguration` also checks the functions settings, so a URL without a token, or plain http in production, stops the API at startup.

## Next Steps

Phase 5 builds the page on these routes. Phase 7 adds the public trigger route outside the contract.
