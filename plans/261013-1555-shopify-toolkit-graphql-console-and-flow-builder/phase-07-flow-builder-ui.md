---
phase: 7
title: "Phase 7: Flow Builder UI"
status: todo
priority: P1
effort: "4d"
dependencies: [6]
---

# Phase 7: Flow Builder UI

## Context Links

- Client-safe flow package entry from phase 6: `packages/flows/src/definition/index.ts`
- API from phase 6: `flows.*` and `flows.nodeTypes` in `packages/api/src/contracts/flows.ts`
- Client-safe import rules: `clientSafeEntrypoints` in `boundaries.config.json`; `transpilePackages` in `apps/app/next.config.ts`
- UI primitives: `packages/design-system` (60 components, including `sheet`, `resizable`, `tabs`, `select`, `field`, `badge`, `empty`)
- Canvas library: `@xyflow/react` 12 (https://reactflow.dev)

## Overview

Deliver the flow list and the canvas builder: drag or click nodes from a palette, connect them, configure each node in a side panel, validate, save versions, and reopen flows exactly as saved.

## Key Insights

- The builder edits the same definition format the engine executes, so the canvas state is a mapping of that format, not a second model.
- Validation logic is pure and client-safe; the canvas can show issues instantly and the server remains the authority on save and run.
- Five node types need bespoke forms (the IF condition builder in particular). A generic form driven by JSON Schema covers simple nodes added later, so a new node does not require UI work unless it wants a custom form.
- Field pickers need sample data. Until a flow has run, the user types templates by hand; after a run, the last item seen at a node can offer field names.

## Requirements

Functional:

- `/flows`: list with name, status, last run and updated time; create, rename, archive.
- `/flows/[flowId]`: canvas with a node palette grouped by category, pan and zoom, add by drag or click, connect by dragging between handles, delete nodes and edges, move nodes.
- Nodes render one input handle (triggers have none) and one labelled output handle per output (`true` and `false` on IF).
- Selecting a node opens its config form; changes mark the flow as unsaved.
- Connections that would create a cycle, a self-loop, or an edge into a trigger are refused while dragging.
- Validate shows an issue list and marks the affected nodes; Save creates a new version and reports a conflict when someone else saved first.
- Leaving with unsaved changes asks for confirmation.
- Users without `flows:manage` see the canvas read-only.

Non-functional:

- The canvas works with keyboard deletion and visible focus states.
- Light and dark themes follow the app.

## Architecture

```text
apps/app/app/flows/
  page.tsx, flows-panel.tsx                 list and create
  [flowId]/page.tsx                         server shell, loads flow + node types
  [flowId]/flow-builder.tsx                 ReactFlow canvas, toolbar (Validate, Save, Run)
  [flowId]/use-flow-editor.ts               nodes, edges, selection, dirty flag, save
  [flowId]/flow-definition-mapping.ts       definition <-> xyflow nodes and edges
  [flowId]/connection-rules.ts              isValidConnection (cycle, self-loop, trigger target)
  [flowId]/flow-node.tsx                    node card with handles, status and issue badge
  [flowId]/node-palette.tsx
  [flowId]/node-config-panel.tsx            picks a form by node type
  [flowId]/config-forms/                    trigger-manual, parse-csv, if, find-order, add-tags,
                                            generic-form (string, number, boolean, enum, string[])
  [flowId]/template-input.tsx               text input with template hint and sample fields
  [flowId]/validation-panel.tsx
```

State lives in `use-flow-editor.ts` on top of xyflow's `useNodesState` and `useEdgesState`. Save sends the mapped definition with `baseVersion`; a 409 opens a dialog offering reload.

Node types and their JSON Schemas come from `flows.nodeTypes`; client-side validation imports `validateFlowDefinition` from `@repo/flows/definition`.

## Related Code Files

- Create: every file in the tree above, with unit tests for `flow-definition-mapping.ts` and `connection-rules.ts`
- Create: `tests/e2e/flow-builder.spec.ts`
- Modify: `apps/app/package.json` (`@xyflow/react`, `@repo/flows`), `apps/app/next.config.ts` (`transpilePackages` gains `@repo/flows`), `packages/config/src/navigation.ts` and its test, `apps/app/app/app-shell-layout.tsx`

## Implementation Steps

1. Add `@xyflow/react` and `@repo/flows` to `apps/app`; add `@repo/flows` to `transpilePackages`. Import only `@repo/flows/definition` from client components; `pnpm boundaries` enforces this.
2. Build the flows list page and its create, rename and archive actions.
3. Write `flow-definition-mapping.ts` with round-trip unit tests: a definition mapped to canvas state and back is unchanged.
4. Write `connection-rules.ts` with unit tests for cycle, self-loop and trigger-target refusal.
5. Build `flow-builder.tsx` with the xyflow stylesheet, custom node type `flow-node.tsx`, background, controls and fit-view.
6. Build the palette. Clicking an entry adds the node at the viewport centre; dragging adds it at the drop point.
7. Build the config panel and the five bespoke forms. The IF form edits a list of conditions with an operator select per row and an all-or-any switch. `template-input.tsx` shows template syntax help.
8. Build `generic-form.tsx` from JSON Schema for string, number, boolean, enum and string-array fields; unsupported shapes fall back to a JSON text area.
9. Wire Validate (client-side instantly, server-side on demand and before save) and the issue badges.
10. Wire Save with `baseVersion`, the conflict dialog, and the unsaved-changes guard.
11. Apply read-only mode from the caller's permissions.
12. Add `Flows` to navigation with an icon.
13. Write the Playwright test: create a flow, add the five nodes by clicking palette entries, connect them, configure each, save, reload, and confirm the same graph and config are shown; clear the tags on one node and confirm validation marks it.
14. Commit.

## Todo

- [ ] Dependencies and transpile settings
- [ ] Flows list page
- [ ] Definition mapping with round-trip tests
- [ ] Connection rules with tests
- [ ] Canvas, custom node, palette
- [ ] Config panel, five bespoke forms, generic form
- [ ] Validation panel and node badges
- [ ] Save with conflict handling and unsaved-changes guard
- [ ] Read-only mode
- [ ] Navigation entry
- [ ] Playwright test green; phase committed

## Success Criteria

- The Playwright test in step 13 passes on the desktop profile.
- Unit tests prove the mapping round-trips and the connection rules refuse the three invalid cases.
- Opening the builder as a user with only `flows:read` shows no palette, no save button, and inputs disabled.
- Two browser sessions saving the same flow: the second save receives the conflict dialog and loses no local edits until the user chooses to reload.
- `pnpm check:ci`, `pnpm check-types`, `pnpm test`, `pnpm boundaries` and `pnpm build` exit 0.

## Risk Assessment

- **Drag-and-drop is flaky in browser automation.** Signal: intermittent Playwright failures. Response: the test uses click-to-add, which is a supported path for users as well.
- **The generic form cannot express a later node's config.** Signal: a phase 9 node needs a control it lacks. Response: add a bespoke form for that node; the JSON text-area fallback keeps the node usable meanwhile.
- **Server and client validation drift.** Both import the same pure function, so drift would need a duplicate implementation. Response: no second implementation is written; the server call exists for authority, not for different rules.

## Security Considerations

- The builder never receives store tokens; store selection happens at run time by id.
- Read-only mode is a convenience; `flows.saveVersion` enforces `flows:manage` on the server.
- Node names and config values are rendered as text, never as HTML.

## Next Steps

Phase 8 adds the Run dialog to the builder toolbar and the run trace view.
