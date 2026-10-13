---
phase: 8
title: "Phase 8: Flow Runs and Trace"
status: todo
priority: P1
effort: "3d"
dependencies: [6, 7]
---

# Phase 8: Flow Runs and Trace

## Context Links

- Run API from phase 6: `flows.runs.start`, `flows.runs.get`, `flows.runs.items.list`, `flows.runs.cancel`, `files.upload`
- Builder from phase 7: `apps/app/app/flows/[flowId]/flow-builder.tsx`, `flow-node.tsx`, `flow-definition-mapping.ts`
- Trace UI precedent: `/Volumes/anh.nguyen/Projects/b8/project-evisu-oms-v2/apps/web/app/(authenticated)/debug/workflows/` (run list, run detail)
- Database-backed browser tests: `scripts/e2e-with-db.mjs`, `playwright.config.ts`
- `@tanstack/react-query` is already a dependency of `apps/app`

## Overview

Let a user run a flow from the builder, watch it progress on the canvas, and inspect every item at every node. Close the phase by proving the plan's run-related acceptance criteria end to end, including a process-level kill and restart.

## Key Insights

- Engine-level resume is covered in phase 6 by aborting the executor in-process. The acceptance criterion is stronger: kill the API process and restart it. That needs a test that drives the real `apps/api` build as a child process.
- A run view is the builder canvas in read-only mode with status overlays, so it reuses the node component and mapping instead of drawing a second graph.
- Run progress changes every second or two for minutes. Polling with a short interval while a run is active is enough; no push channel is needed.
- Real-store behaviour (actual tags in Shopify admin, real rate limits) cannot be automated without the user's credentials, so it is a recorded manual checklist.

## Requirements

Functional:

- Run dialog in the builder: choose a connected store, fill the manual trigger's inputs (file upload for file inputs), start. Saving is required first when the flow has unsaved changes.
- Runs list per flow: status, store, who started it, start time, duration, item counts.
- Run view: each node shows its status and counts (in, succeeded, failed, unknown); edges carry the item count that travelled along them.
- Selecting a node lists its items with a status filter, pagination, the input, the output and the error for each.
- Cancel while running.
- The view refreshes while the run is active and stops polling when it is terminal.

Non-functional:

- The item list stays responsive at 10,000 items per node (server pagination, 50 per page).
- Failed-item errors show Shopify's message and `userErrors` fields as text.

## Architecture

```text
apps/app/app/providers.tsx                         QueryClientProvider (mounted in layout.tsx)
apps/app/app/flows/[flowId]/run-dialog.tsx          store select + trigger inputs + upload
apps/app/app/flows/[flowId]/runs/page.tsx           runs list
apps/app/app/flows/[flowId]/runs/[runId]/page.tsx   server shell
apps/app/app/flows/[flowId]/runs/[runId]/run-trace.tsx        read-only canvas with overlays
apps/app/app/flows/[flowId]/runs/[runId]/run-items-panel.tsx  items of the selected node
apps/app/app/flows/[flowId]/runs/[runId]/use-run-polling.ts   refetch every 2 s while active
```

`flows.runs.get` returns the run, its version's definition, and per-node aggregates computed by one grouped query on `(runId, nodeId, status)`. The trace renders the definition of the run's own version, so later edits to the flow do not change old traces.

Process-level resume test (`apps/api/integration/flow-run-resume.integration.test.ts`):

```text
start fake Shopify server with ~50 ms latency
build apps/api, spawn it with JOBS_PROVIDER=pgboss and the admin base URL override
seed organization, store, flow; upload a 300-row CSV; start the run through HTTP
wait until ~100 items are checkpointed -> SIGKILL the API process
spawn it again -> poll the run until terminal
assert: run SUCCEEDED; every order tagged; fake server saw at most one extra tagsAdd
        per item that was in flight at the kill, and exactly one for all others
```

## Related Code Files

- Create: the files in the tree above
- Create: `apps/api/integration/flow-run-resume.integration.test.ts`, `tests/e2e/flow-run.spec.ts`, `tests/fixtures/orders-sample.csv`
- Create: `docs/flows.md`
- Modify: `apps/app/app/layout.tsx` (providers), `apps/app/app/flows/[flowId]/flow-builder.tsx` (Run button), `apps/app/app/flows/[flowId]/flow-node.tsx` (overlay props), `apps/api/package.json` (integration script), `packages/flows/src/services/runs.ts` (aggregates, if not already shaped for the view)

## Implementation Steps

1. Mount a `QueryClientProvider` in the app layout.
2. Build the run dialog. File inputs upload through `files.upload` first and pass the returned asset id in the run inputs. Show upload and validation errors inline.
3. Build the runs list with status badges and links.
4. Extend `flow-node.tsx` with optional run overlay props and build `run-trace.tsx` on the read-only canvas.
5. Build the items panel with status filter and pagination; render JSON with a collapsed-by-default viewer.
6. Add polling and the cancel action; stop polling on a terminal status.
7. Write the process-level resume test as specified. Track the child process ids and stop them in teardown, including on failure.
8. Write the Playwright journey: sign in, open a seeded flow, start a run with the fixture CSV against the fake server, watch the trace reach a terminal state, open the failed row and read its error.
9. Manual acceptance on a real dev store and record the evidence in this file's checklist:
   - a CSV of at least 20 real order names with totals on both sides of 1000;
   - every order carries the expected tag in Shopify admin;
   - a second run adds no duplicate tag;
   - one deliberately wrong order name fails alone;
   - the API is stopped mid-run and started again, and the run finishes.
10. Write `docs/flows.md`: building a flow, template syntax, node reference, run statuses, what at-least-once and `UNKNOWN` mean, limits.
11. Commit.

## Todo

- [ ] Query provider mounted
- [ ] Run dialog with file upload
- [ ] Runs list
- [ ] Run trace canvas with overlays
- [ ] Items panel with filter and pagination
- [ ] Polling and cancel
- [ ] Process-level kill-and-restart test green
- [ ] Playwright run journey green
- [ ] Manual acceptance on a dev store recorded
- [ ] User documentation written; phase committed

## Success Criteria

- The process-level test passes three consecutive times locally.
- The Playwright journey passes on the desktop profile.
- The manual checklist in step 9 is complete, with the store domain and run ids noted.
- With a 10,000-row fixture against the fake server, the run view stays interactive and the items panel pages in under one second per page.
- `pnpm check:ci`, `pnpm check-types`, `pnpm test`, `pnpm test:e2e:db`, `pnpm boundaries` and `pnpm build` exit 0.

## Risk Assessment

- **The kill test is timing-sensitive.** Signal: flaky pass rate. Response: trigger the kill on an observed checkpoint count rather than a timer, and give the restart a generous poll deadline.
- **Orphaned child processes from the test.** Signal: ports still held after a failed run. Response: teardown kills by recorded pid; the test binds a fixed non-default port so a stale owner is identifiable.
- **Aggregates are slow on large runs.** Signal: `flows.runs.get` above a few hundred milliseconds at 50,000 item rows. Response: the composite index from phase 6 covers the grouped query; if it does not, cache counts on `FlowRunStep` at checkpoint time.

## Security Considerations

- Run and item reads require `flows:read` on the flow's organization; ids from another organization return 404.
- Item payloads can contain customer data. They are rendered as text and never placed in URLs or logs.
- Uploaded files are stored under organization-scoped keys and are only read by the worker; there is no public download route.

## Next Steps

Phase 9 adds triggers that start runs without the dialog, and more nodes.
