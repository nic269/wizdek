---
phase: 6
title: "Phase 6: Flow Engine Core"
status: todo
priority: P1
effort: "5d"
dependencies: [2, 3, 5]
---

# Phase 6: Flow Engine Core

## Context Links

- Patterns to reuse (not code to copy) in `/Volumes/anh.nguyen/Projects/b8/project-evisu-oms-v2/apps/api/src/lib/workflow-engine/`: typed registries (`action-registry.ts`, `condition-registry.ts`), path resolution with fallbacks (`variable-resolver.ts`)
- Trace model precedent: `WorkflowRun` and `WorkflowRunLog` in `/Volumes/anh.nguyen/Projects/b8/project-evisu-oms-v2/packages/database/prisma/schema.prisma`
- Tag mutation precedent: `addOrderTags` in `/Volumes/anh.nguyen/Projects/b8/project-evisu-oms-v2/packages/shopify/src/orders.ts`
- Storage interface: `packages/storage/src/provider.ts` (`getObject` returns the whole body), `FileAsset` model
- Job runtime from phase 5: `packages/jobs/src/index.ts`, `packages/api/src/jobs.ts`

## Overview

Build `@repo/flows`: the flow definition format, the node registry, the durable item-based executor, persistence for flows, versions and run traces, the five nodes the CSV example needs, and the API to manage and run flows. No canvas yet; the phase is proven through the API.

## Key Insights

- evisu's `pipeline-executor.ts` runs a fixed conditions-then-actions list per import row and is tied to `ImportType`. It is not a graph engine, so only its registry and path-resolution ideas carry over.
- The user's example is per-row: parse a CSV, branch each order on its total, tag it. An item model (every node receives and emits items) expresses this without loop nodes.
- Resuming without redoing work needs a checkpoint per item per node. Storing each node's input items as rows gives the checkpoint, the per-item trace, and the hand-off between nodes in one table.
- A Shopify call can succeed just before a crash, before its checkpoint is written. Tag addition is idempotent, so re-execution is harmless; a generic mutation is not, so nodes declare `idempotent`.
- Two extension shapes are needed later (phase 9) and are cheap to allow now: outputs derived from config (switch) and batch execution over all of a node's items (bulk operation).

## Requirements

Functional:

- Flows have immutable versions; a run references the exact version it executed.
- Validation reports issues per node: exactly one trigger, no cycles, every node reachable from the trigger, config valid against the node's schema, edges attached to existing output handles.
- A run executes in one store context chosen when the run starts.
- An item that fails is recorded as failed with its error; other items continue. A node-level failure (store needs reconnecting, invalid config at run time) fails the run and leaves remaining items pending.
- Runs can be cancelled between items.
- Built-in nodes: `trigger.manual`, `data.parseCsv`, `logic.if`, `shopify.findOrder`, `shopify.addTags`.
- Templates such as `{{ $json.total }}` and `{{ $json["Order Name"] }}` read item fields.

Non-functional:

- Definitions are data. Templates resolve paths only; nothing evaluates code.
- Resuming a run never re-executes an item whose checkpoint was written.
- Limits: 100 nodes per flow, 100,000 items per run, 1 MB per item (order webhook payloads in phase 9 can run to several hundred kilobytes), 10 MB per uploaded file. <!-- Updated: Red Team Review - item limit was below realistic webhook payloads -->
- File uploads pass the same origin check as `/api/shopify/*` and `/api/flows/*`; a multipart POST is otherwise the one request shape a foreign page can send without a preflight. <!-- Updated: Red Team Review - upload route sat outside the origin check -->

## Architecture

Package `packages/flows` (`@repo/flows`); may import `@repo/database`, `@repo/jobs`, `@repo/logger`, `@repo/shopify`, `@repo/storage`. Subpaths: `.` (server), `./definition` (client-safe: schemas, types, validation, templates, conditions).

Definition (stored as JSON, `schemaVersion: 1`):

```ts
{ schemaVersion: 1,
  nodes: [{ id, type, name, position: { x, y }, config }],
  edges: [{ id, source, sourceHandle, target }] }
```

Node contract:

```ts
defineNode({
  type: "shopify.addTags", category: "action",       // trigger | data | logic | action
  label, description,
  configSchema: z.object({ ... }),
  outputs: ["main"],                                  // or (config) => string[]
  mode: "item",                                       // or "batch"
  idempotent: true, concurrency: 4,
  execute({ item, config, ctx }) -> { outputs: [{ handle, json }] }
})
```

`ctx` gives `run`, `store`, `shopify.request(query, variables)` (token resolved, throttle-aware), `storage`, `resolve(template, item)`, `stepState` (get and set, persisted), `logger`, `signal`.

Data model:

```prisma
enum FlowStatus { DRAFT ACTIVE ARCHIVED }
enum FlowRunStatus { QUEUED RUNNING SUCCEEDED PARTIALLY_FAILED FAILED CANCELED }
enum FlowStepStatus { PENDING RUNNING SUCCEEDED FAILED SKIPPED }
enum FlowItemStatus { PENDING IN_PROGRESS SUCCEEDED FAILED UNKNOWN }

model Flow { id, organizationId, name, description?, status, currentVersionId?, createdById?, createdAt, updatedAt }
model FlowVersion { id, flowId, version Int, definition Json, createdById?, createdAt
                    @@unique([flowId, version]) }
model FlowRun { id, organizationId, flowId, flowVersionId, storeId, status, triggerType,
                triggerPayload Json?, startedById?, startedAt?, completedAt?,
                cancelRequestedAt?, error Json?, createdAt
                @@index([flowId, createdAt]) }
model FlowRunStep { id, runId, nodeId, nodeType, status, state Json?, error Json?,
                    startedAt?, completedAt?
                    @@unique([runId, nodeId]) }
model FlowRunItem { id, runId, nodeId, itemKey, status, input Json, output Json?,
                    outputHandle?, error Json?, attempts Int, durationMs Int?, updatedAt
                    @@unique([runId, nodeId, itemKey])
                    @@index([runId, nodeId, status]) }
```

A `FlowRunItem` row is one input item waiting at one node. When a node finishes an item, one transaction marks that row done (with an output snapshot) and inserts the emitted items as `PENDING` rows of each downstream node, using `skipDuplicates` on the unique key. Item keys are deterministic: the trigger item is `0`, a node that expands one item into many appends `.<index>`, a one-to-one node keeps the key.

Executor (one `flow-run` job per run, `serialPerKey` with the store id as key):

```text
load run + version -> topological order
for each node in order:
  skip if its step is already terminal
  trigger node: insert its single item from run.triggerPayload if absent
  no items at all -> step SKIPPED
  loop over PENDING items in batches of node.concurrency:
     non-idempotent node: mark IN_PROGRESS before the call
     execute -> checkpoint transaction (item SUCCEEDED + downstream PENDING rows)
     item error -> item FAILED with details
     honour cancelRequestedAt and the abort signal between batches
  step SUCCEEDED (item failures are counted, not fatal); node-level error -> step and run FAILED
finish: SUCCEEDED | PARTIALLY_FAILED (any FAILED or UNKNOWN item) | FAILED | CANCELED
on resume: IN_PROGRESS items of non-idempotent nodes become UNKNOWN and are not retried;
           IN_PROGRESS never occurs for idempotent nodes, whose PENDING items simply run
```

Built-in nodes:

| Node | Config | Behaviour |
|------|--------|-----------|
| `trigger.manual` | `inputs: [{ key, label, type: file \| text \| number }]` | Emits one item from the run inputs |
| `data.parseCsv` | `file` template, delimiter, `hasHeader`, `trimValues`, `skipEmptyRows` | Reads the asset from storage, emits one item per row keyed by header |
| `logic.if` | `combinator: all \| any`, `conditions: [{ left, operator, right, valueType }]` | Outputs `true` and `false`; numeric comparison tolerates currency symbols and thousands separators and fails the item on a non-number |
| `shopify.findOrder` | `by: name \| id`, `value` template | Adds `order { id, name, tags, totalPrice, currencyCode }`; zero matches fails the item |
| `shopify.addTags` | `resourceId` template, `tags` templates | `tagsAdd`; `userErrors` fail the item; idempotent |

API (oRPC):

| Operation | Permission |
|-----------|------------|
| `flows.list`, `flows.get`, `flows.nodeTypes`, `flows.runs.list`, `flows.runs.get`, `flows.runs.items.list` | `flows:read` |
| `flows.create`, `flows.update`, `flows.saveVersion`, `flows.validate` | `flows:manage` |
| `flows.runs.start`, `flows.runs.cancel` | `flows:run` |
| `files.upload` (multipart, CSV only, 10 MB) | `flows:run` |

`flows.saveVersion` takes `baseVersion` and answers 409 when it is stale. `flows.runs.start` checks that the store and any uploaded asset belong to the flow's organization. `flows.nodeTypes` returns registry metadata with each config schema as JSON Schema.

## Related Code Files

- Create: `packages/flows/package.json`, `tsconfig.json`
- Create: `packages/flows/src/definition/schema.ts`, `validate.ts`, `template.ts`, `conditions.ts`, `index.ts`
- Create: `packages/flows/src/registry/define-node.ts`, `registry.ts`
- Create: `packages/flows/src/nodes/trigger-manual.ts`, `data-parse-csv.ts`, `logic-if.ts`, `shopify-find-order.ts`, `shopify-add-tags.ts`, `index.ts`
- Create: `packages/flows/src/engine/topology.ts`, `item-store.ts`, `executor.ts`, `run-job.ts`
- Create: `packages/flows/src/services/flows.ts`, `runs.ts`; `packages/flows/src/index.ts`
- Create: unit tests beside each file; `packages/flows/integration/executor.integration.test.ts`
- Create: `packages/api/src/contracts/flows.ts`, `packages/api/src/routers/flows.ts` with tests; one Prisma migration `flows`
- Modify: `packages/database/prisma/schema.prisma`, `packages/api/src/contracts/files.ts`, `packages/api/src/routers/files.ts`, `packages/api/src/contracts/index.ts`, `packages/api/src/routers/index.ts`, `packages/api/src/jobs.ts`, `packages/api/src/app.ts` (origin check for `/api/flows/*` and file uploads), `packages/api/package.json`
- Modify: `packages/access-control/src/catalog.ts`, `roles.ts`; `boundaries.config.json`; `docs/architecture.md`

## Implementation Steps

1. Scaffold the package. Add `csv-parse`. Register boundary rules: `@repo/flows` allowlist as above, `clientSafeEntrypoints` `["./definition"]`, and add `@repo/flows` to the `@repo/api` allowlist.
2. Write the definition schema and `validate.ts` as pure functions that take node-type metadata as an argument, so the browser can run the same validation.
3. Write `template.ts`: tokenise `{{ ... }}`, resolve `$json`, `$trigger` and `$run` paths with dot and quoted-bracket segments, reject `__proto__`, `constructor` and `prototype`, return the raw value when the whole string is one template.
4. Write `conditions.ts`: operators `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `endsWith`, `isEmpty`, `isNotEmpty` with typed coercion.
5. Write `define-node.ts` and the registry, including JSON Schema export of config schemas.
6. Add the Prisma models, migrate, generate.
7. Write `topology.ts` and `item-store.ts`. The checkpoint transaction is the only place item and downstream rows change together.
8. Write `executor.ts` as specified, taking its collaborators (item store, store client factory, storage, clock) as parameters.
9. Write the five nodes. Quote and escape the order name in the `findOrder` search string. Parse CSV with BOM stripping.
10. Write `run-job.ts` and register it in `packages/api/src/jobs.ts` with `serialPerKey`, a heartbeat, and the maximum timeout.
11. Write the services, then the `flows` contract and router. Extend the `files` contract with `upload`; confirm multipart handling through oRPC and through the Next rewrite, and fall back to a plain Hono multipart route if the contract route cannot carry files.
12. Add permissions `flows:read`, `flows:manage`, `flows:run`; give `MEMBER_PERMISSIONS` `flows:read` and `flows:run` (authoring flows, `flows:manage`, stays with Admin, Owner and custom roles); run `pnpm db:sync-roles` locally. <!-- Updated: Validation Session 1 - Member may run flows -->
13. Write unit tests, then the integration suite below against Postgres, the pg-boss provider and the fake Shopify server.
14. Update `docs/architecture.md` with the item model, run states and at-least-once semantics. Commit.

## Todo

- [ ] Package scaffolded; boundary rules registered
- [ ] Definition schema, validation, templates and conditions with unit tests
- [ ] Node contract and registry
- [ ] Prisma models migrated
- [ ] Item store and executor
- [ ] Five built-in nodes with tests
- [ ] `flow-run` job registered
- [ ] Flow and run services, contracts and routers
- [ ] File upload route
- [ ] Permissions added and roles resynced
- [ ] Integration suite green
- [ ] Docs updated and phase committed

## Success Criteria

Integration tests, each asserting on database state and on the fake server's request log:

- The example flow over a 50-row CSV tags every order with the tag its total dictates.
- A row naming an unknown order ends `FAILED` with a readable error; the other rows succeed; the run ends `PARTIALLY_FAILED`.
- Running the same CSV twice leaves each order with exactly one copy of its tag.
- The executor aborted after a fixed number of items and started again completes the run; no item with a written checkpoint is executed a second time.
- With the fake server answering `THROTTLED` intermittently, the run completes with no failed item.
- A cancel request during the run ends it `CANCELED` with the remaining items `PENDING`.
- A non-idempotent test node interrupted mid-call leaves that item `UNKNOWN` after resume.
- Validation flags a cycle, an unreachable node, a second trigger and a missing required config field, each on the right node.
- A user whose role lacks `flows:run` (a Viewer or a custom role) cannot start a run; a Member can start one but cannot save a version; a store or asset from another organization is rejected.

`pnpm check:ci`, `pnpm check-types`, `pnpm test`, `pnpm boundaries` and `pnpm build` exit 0.

## Risk Assessment

- **Item rows grow large.** A 10,000-row CSV through five nodes writes about 50,000 rows. Signal: slow inserts or trace queries. Response: inserts are chunked by 1,000 and reads are paginated on the composite index; if runs approach the 100,000-item limit, shorten retention before changing the model.
- **File upload through oRPC or the Next rewrite is limited.** Signal: step 11 fails or truncates. Response: the plain multipart route, and a lower size limit if the proxy imposes one.
- **Topological execution is too coarse for future merge semantics.** A node with several incoming edges receives the concatenation of their items. That is sufficient for the requested flows; richer joins would be a new node mode, not an executor rewrite.

## Security Considerations

- `flows:run` lets a user change store data through any action node, with the store token's full scopes. This is documented beside the permission.
- Templates cannot execute code or reach object prototypes.
- Search strings and GraphQL variables are built from item data as values, never concatenated into query text; the one search string is quoted and escaped.
- Run items hold business data from CSV files and stores. They are organization-scoped and readable only with `flows:read`. Retention is unlimited in this plan; a retention policy is required before public launch.

## Next Steps

Phase 7 builds the canvas on `@repo/flows/definition` and `flows.nodeTypes`. Phase 8 adds the run UI and the process-level kill test. Phase 9 adds nodes that use `outputs` as a function and `mode: "batch"`.
