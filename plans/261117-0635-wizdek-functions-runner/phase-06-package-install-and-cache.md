---
phase: 6
title: "Phase 6: Package Install and Cache"
status: completed
priority: P1
effort: "1.5d"
dependencies: [2, 4, 5]
---

# Phase 6: Package Install and Cache

## Context Links

- Run container options and work directory: phase 2 (`apps/runner/src/run-container.ts`, `workspace.ts`)
- Save and execute services: phase 3 (`packages/functions/src/services/`)
- Incident that makes install scripts untrusted: `infra:docs/build-log.md` (2026-10-18)

## Overview

Install a function's packages from `package.json` or `requirements.txt` in a build container, cache the result by manifest hash, and mount it read-only into runs.

## Key Insights

- An install runs arbitrary code (lifecycle scripts, source builds). It gets the same sandbox as a run, plus a writable output directory, and never the function's variables.
- The cache key includes the runtime image tag, so a new base image rebuilds native modules instead of reusing stale ones.
- Functions with the same manifests share one cache entry, which is safe because entries are read-only.
- The runner disk is 32 GiB. A size cap per entry, a free-space floor and eviction keep installs from filling it.

## Requirements

- Manifests: `package.json` with optional `package-lock.json` for Node; `requirements.txt` for Python. No manifest means no install and no mount.
- Build container: sandbox network, no user env, memory 1024 MB, timeout 300 s, same hardening as a run except a writable bind mount at `/deps`.
- Node: `npm install --omit=dev --no-audit --no-fund` (`npm ci` when a lock file is present); the result is mounted at `/fn/node_modules`. Python: `pip install --no-cache-dir --target /deps -r requirements.txt`; mounted at `/deps` with `PYTHONPATH=/deps`.
- An entry larger than 500 MB is deleted and reported as failed. A build is refused when free disk is under 4 GiB.
- A build writes to `<key>.tmp` and is renamed to `<key>` with a completion marker only on success, so a crashed build is never used.
- Eviction: entries unused for 30 days, and least-recently-used entries while free disk is under 8 GiB; an entry mounted by a running container is never removed.
- A function whose packages are installing cannot run; the UI says so. A failed install shows the end of its log.

## Architecture

Agent: `POST /deps` with `{ runtime, manifests }` returns an NDJSON stream of `output` events and a final `{ type: "done", key, status, sizeBytes, error? }`. If `<key>` already exists it answers `done` immediately. `POST /runs` takes `depsKey` and fails clearly when the entry is missing, so the API can rebuild and retry once.

Data: `CodeFunction` gains `depsStatus` (`NONE`, `BUILDING`, `READY`, `FAILED`), `depsKey`, `depsLog` (last 16 KB) and `depsBuiltAt`.

Flow:

```text
saveFiles -> manifest hash changed? -> depsStatus BUILDING -> runner.buildDeps (not awaited)
          -> READY with key | FAILED with log tail
startRun  -> BUILDING: refuse | READY: pass depsKey | entry evicted: rebuild, then run
```

## Related Code Files

- Create: `apps/runner/src/build-deps.ts`, `deps-cache.ts`; modify `src/index.ts`, `run-container.ts`, `protocol.ts`
- Create: `apps/runner/integration/deps.integration.test.ts`; unit tests for cache key and eviction order
- Modify: `packages/database/prisma/schema.prisma`; create one migration
- Modify: `packages/functions/src/runner/client.ts`, `services/functions.ts`, `services/runs.ts`, the fake runner; create `services/deps.ts`
- Modify: `packages/api/src/contracts/functions.ts`, `routers/functions.ts` (deps fields on the function; `POST /api/functions/{functionId}/deps/rebuild`, manage)
- Modify: `apps/app/app/functions/[functionId]/function-workbench.tsx`, `output-tab.tsx`, `monaco-setup.ts` (packages status, install log, unresolved-import diagnostics off)
- Modify: `.env.example`, `turbo.json` (`RUNNER_DEPS_MAX_MB`, `RUNNER_DEPS_MIN_FREE_GB`)

## Implementation Steps

1. Write `deps-cache.ts`: key, paths, completion marker, last-used touch, in-use reference counts, eviction.
2. Write `build-deps.ts` and the route; extend `run-container.ts` with the mounts.
3. Add the model fields and migration; write `services/deps.ts`; hook it into `saveFiles` and `startRun`.
4. Extend the contract and router; add the rebuild route.
5. Add the packages status, install log and Reinstall action to the workbench.
6. Write the tests.

## Todo

- [x] Cache and eviction
- [x] Build container and route
- [x] Mounts in runs
- [x] Model, service and API
- [x] Workbench status and log
- [x] Tests

## Outcome (2026-11-18)

Built as planned, with these differences:

- `CodeFunction` also stores `depsHash` (the hash of the manifests), so a save installs again only when the manifests change and a late install cannot overwrite the status of newer manifests. It stores `depsError` apart from `depsLog`, so the workbench can lead with one sentence.
- The rebuild route is `POST /api/functions/{functionId}/deps/rebuild` (operation `functions.reinstallDeps`). It needs `functions:manage` and is audited as `function.deps.reinstalled`. The API never returns `depsKey` or `depsHash`.
- A run is refused while packages install or after an install failed (`DEPS_NOT_READY`, 409). The Run buttons are disabled in both states.
- When the runner answers `DEPS_MISSING` because it evicted the entry, the run installs again, notes that in its output and retries once.
- An install the API process was driving when it stopped is marked failed at startup, next to interrupted runs.
- The install runs as the agent's own user, so the agent can delete what it wrote when it evicts the entry. An agent running as root hands the directory to the sandbox user instead.
- When the runner already has the packages, or the same manifests are already installing, the agent writes one line saying so. Without it the log would be empty and look broken.
- `monaco-setup.ts` needed no change. The `declare module "*"` added in phase 5 already keeps package imports from being underlined.
- Node no longer prints `MODULE_TYPELESS_PACKAGE_JSON` for a `package.json` without `"type"`.
- Fixed in passing: choosing the run already shown in History left the Output tab on "Loading the run…".

Verification:

| Suite | Result |
|-------|--------|
| Runner, local Docker | 22 integration tests and 32 unit tests pass |
| Functions service, fake runner | 35 tests pass |
| API functions routes | 6 tests pass |
| Browser suite, fake runner | 36 passed, 10 skipped (desktop-only specs on the phone project) |
| Typecheck, lint, boundaries | clean |

What the runner tests cover:

- They install `ms` from npm and `six` from PyPI, and run functions that import each.
- Repeating an install with the same manifests answers from the cache, and a changed manifest gets a new key.
- An install over the size cap fails and leaves nothing behind.
- A package that does not exist fails, with its output kept.
- A root `preinstall` script that dumps its environment finds neither the token nor any `RUNNER_` setting.
- Eviction order, and keeping an entry that is in use, are unit-tested on real directories.

The new browser test also passed against the real runner in `pnpm dev`. It installed `ms`, showed the log and ran the function.

## Success Criteria

Agent integration tests (local Docker with internet):

- A Node function that imports a small npm package, and a Python function that imports a small PyPI package, install and run.
- A second build with the same manifests answers without starting a container; a changed manifest produces a new key.
- With the size cap lowered through `RUNNER_DEPS_MAX_MB`, an install over the cap fails and leaves no entry.
- The build container's environment holds none of the function's variables.
- Eviction removes the least-recently-used entry and skips one in use.

Service and API tests against the fake runner: a run is refused while packages install; a failed install stores its log tail; an evicted entry is rebuilt on the next run.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| A runaway install fills the disk before the size check | Free-space floor before the build, 300 s timeout, eviction after; the temp directory is removed on any failure |
| Registry outage | The install fails with its log; runs of functions whose entry is cached are unaffected |
| A malicious package | It runs in the sandbox without variables and cannot reach the LAN; it can see the function's source at run time, which is the accepted limit of installing third-party code |

## Security Considerations

- The build container never receives env var values.
- Install logs are stored as text and capped; they are readable with `functions:read`.

## Next Steps

Phase 7 adds the variables that this phase keeps out of builds.
