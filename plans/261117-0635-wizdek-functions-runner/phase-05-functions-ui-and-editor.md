---
phase: 5
title: "Phase 5: Functions UI and Editor"
status: completed
priority: P1
effort: "3d"
dependencies: [4]
---

# Phase 5: Functions UI and Editor

## Context Links

- Monaco under Next 16, and how it was verified: `docs/decisions/0003-graphiql-bundling.md`, `apps/app/app/graphql/graphql-console.tsx`
- Form from JSON Schema: `apps/app/app/flows/[flowId]/config-forms/generic-form.tsx`, `form-parts.tsx`
- Save with conflict dialog: `apps/app/app/flows/[flowId]/use-flow-editor.ts`
- Polling: `apps/app/app/flows/[flowId]/runs/[runId]/use-run-polling.ts`
- Server-side permission check before render: `apps/app/app/database/[connectionId]/page.tsx`
- Shell, navigation and shared queries: `packages/config/src/navigation.ts`, `apps/app/app/shell/nav.tsx`, `shell/command-palette.tsx`, `apps/app/app/lib/queries.ts`, `lib/permissions.ts`
- Visual language and components: `docs/architecture.md` (App UI), `docs/design/`

## Overview

Build the Functions page: a list, and a workbench per function with a file tree, tabbed Monaco editor, a parameter form, live run output, run history and settings.

## Key Insights

- GraphiQL already ships `monaco-editor` 0.52.2, and decision 0003 proved its workers start under the default Next 16 toolchain. That proof covers GraphiQL's own worker setup, not a standalone editor with the TypeScript worker, so this phase starts by proving that.
- Monaco needs the browser, so the editor is loaded with `next/dynamic` and `ssr: false`, like the console.
- Installed packages have no type information in the browser. Unresolved-import diagnostics (TypeScript codes 2307 and 7016) are switched off so every third-party import is not underlined.
- "Run" always runs saved code. The button saves first when the editor is dirty, which keeps one source of truth and one inspection path.

## Requirements

- Navigation: "Functions" under Automation after Flows, with an icon on the rail and a command-palette entry.
- List: name, runtime, last run status and time; create dialog (name, runtime); loading, empty, error, read-only and not-enabled states, like the other list pages.
- Workbench, full-width panel: file tree (add, rename, delete; the entry file cannot be removed), tabs with a dirty marker, editor with language by extension.
- Right panel tabs: **Test** (parameter form and Run), **Output** (streaming text, result, exit code, duration, truncation notice), **History** (runs with status, trigger, duration; selecting one shows its output), **Settings** (name, description, timeout, memory, delete).
- Save with Cmd/Ctrl+S; run with Cmd/Ctrl+Enter; Cancel while running. A 409 on save opens the same kind of dialog as the flow builder and keeps local edits.
- When inspection fails the Test tab shows the inspector's message and still lets the user run with raw JSON params.
- Without `functions:manage` the editor is read-only and Save is absent; without `functions:run` Run is absent. The server stays the authority.
- Light theme only, using the existing tokens and components.

## Architecture

```text
app/functions/page.tsx                 server shell -> functions-list.tsx
app/functions/[functionId]/page.tsx    server: permission check -> function-workbench.tsx
  file-tree.tsx | editor-tabs.tsx + code-editor.tsx (dynamic, ssr:false) | side-panel.tsx
  use-function-editor.ts   draft files, dirty state, save(baseHash), conflict
  use-function-run.ts      start, poll every second while QUEUED/RUNNING, cancel
```

The schema-driven fields of `generic-form.tsx` move to `apps/app/app/lib/schema-form.tsx`; the flow builder's generic form and the Test tab both use it. It gains integer handling and honours `x-order`.

## Related Code Files

- Modify: `packages/config/src/navigation.ts`, `navigation.test.ts`
- Modify: `apps/app/app/shell/nav.tsx`, `shell/command-palette.tsx`, `apps/app/app/lib/queries.ts`
- Create: `apps/app/app/lib/schema-form.tsx`; modify `apps/app/app/flows/[flowId]/config-forms/generic-form.tsx` to use it
- Create under `apps/app/app/functions/`: `page.tsx`, `functions-list.tsx`, `new-function-dialog.tsx`, `not-enabled.tsx`
- Create under `apps/app/app/functions/[functionId]/`: `page.tsx`, `function-workbench.tsx`, `file-tree.tsx`, `editor-tabs.tsx`, `code-editor.tsx`, `monaco-setup.ts`, `side-panel.tsx`, `test-tab.tsx`, `output-tab.tsx`, `history-tab.tsx`, `settings-tab.tsx`, `use-function-editor.ts`, `use-function-run.ts`
- Modify: `apps/app/next.config.ts` (`transpilePackages` gains `@repo/functions`)
- Modify: `apps/app/proxy.ts` (add `/functions` to `protectedPrefixes` and the matcher)
- Create: `tests/e2e/functions.spec.ts`; modify `playwright.config.ts` to start the fake runner

## Implementation Steps

1. Spike: a throwaway page with a standalone Monaco editor and the TypeScript worker. Check in `next dev` and in `next build` followed by `next start` that workers start, completion works in a `.ts` file, and there are no page errors. If it fails, serve Monaco's prebuilt `min/vs` files from `public/` through its loader and record the outcome in decision 0006.
2. Add navigation, icon, palette entry and query hooks.
3. Extract `schema-form.tsx` and switch the flow builder to it; run the flow builder's tests.
4. Build the list page with all states and the create dialog.
5. Build the workbench: editor state hook, file tree, tabs, editor.
6. Build the side panel tabs and the run hook.
7. Write the browser test.

## Todo

- [x] Monaco spike recorded
- [x] Navigation and queries
- [x] Shared schema form
- [x] List page and states
- [x] Workbench editor
- [x] Test, Output, History, Settings tabs
- [x] Browser test

## Outcome (2026-11-17)

Monaco spike, for decision 0006 in phase 8. The standalone editor imports `monaco-editor` 0.52.2 and starts workers with `new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url))`, as GraphiQL's webpack setup does. It needs no bundler override and no prebuilt `min/vs` fallback.

| Check | `next dev` | `next build` + `next start` |
|-------|-----------|------------|
| TypeScript and editor workers start | yes | yes |
| Completion across files (`greet` from `lib/util.ts`) | yes | yes |
| Type errors underlined; unresolved package import not | yes | yes |
| Uncaught page errors | none | none |
| Switching between GraphiQL and the editor without reload | yes | yes |

- GraphiQL installs its own `MonacoEnvironment`. The functions editor installs its environment on every mount and passes labels it does not handle, such as `graphql`, to the one that was there before. The check above confirmed GraphiQL still gets its GraphQL worker after visiting the editor.
- Disposing an editor rejects Monaco's pending timers with a `Canceled` error. Those rejections are filtered.
- The editor owns the text while it is open. File contents from the server overwrite open models only after a load; otherwise a render trailing fast typing rolled keystrokes back. Saving no longer replaces drafts, so edits made while a save is in flight are kept.

Other changes made along the way:

- `playwright.config.ts` reads the app and API addresses from `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_API_URL`. The local stack moved to ports 4000/4002 earlier, and the suite could no longer start its servers.
- It also starts the fake runner (`pnpm --filter @repo/functions fake-runner`) and points the API at it.
- The fake runner's inspector reads defaults. Defaulted parameters are optional, as with the real inspector.

Verification: `tests/e2e/functions.spec.ts` passes (author flow, not-enabled state, read-only reader). The flow builder specs pass with the shared schema form. App unit tests, the functions and API integration suites, typecheck, lint and boundaries pass.

The full browser suite passes (34 passed; the 8 skipped are the desktop-only editor specs on the phone project). Nine older specs failed before this was fixed:

- The password recovery spec still sent the old app origin, so the API refused it.
- The sign-up smoke spec looked for the user's email on the dashboard. It now opens the account menu, which is where the redesigned shell shows the email.
- On phones, the organization switcher and account menu sit in the navigation sheet. The helpers in `tests/e2e/support/user-flows.ts` open the sheet first.

Disposing an editor rejected an internal Monaco timer promise with "Canceled", and the Next.js dev overlay reported it on every mount. `monaco-setup.ts` now catches Monaco's own cancellations at the source and lets every other error through.

Local development turns functions on with `RUNNER_TOKEN`, `FUNCTIONS_RUNNER_URL=http://127.0.0.1:3003` and the matching `FUNCTIONS_RUNNER_TOKEN` in `.env`. `pnpm dev` then starts the agent against local Docker.

Imports: Node runs TypeScript only when the import names the full file, but the editor's completion writes `./lib/util`.
- The Node runtime's wrapper registers a resolve hook. When a relative import does not resolve as written, the hook tries `.ts`, `.mts`, `.js`, `.mjs` and a folder's `index` file. A path to a missing file still fails with Node's own message.
- The editor allows `.ts` in imports and types package imports loosely through `declare module "*"`. Relative imports never match that declaration, so a missing file is now underlined. Before, "cannot find module" was switched off for every import, which hid mistyped paths.
- Tests: `apps/runner/integration/run.integration.test.ts` and the imports case in `tests/e2e/functions.spec.ts`.

## Success Criteria

- The browser test, against the fake runner: creates a TypeScript function, adds a second file, saves, reloads and finds both files; sees three typed fields for the sample signature; edits the signature, saves and sees the form change; runs and sees output, result and a history row; sees the not-enabled state when the runner URL is unset.
- A user without `functions:manage` sees a read-only editor.
- The flow builder's generic form behaves as before.
- No uncaught page errors in development or the production build.
- `pnpm --filter @repo/app test`, `check-types` and `pnpm test:e2e` pass.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Standalone Monaco workers fail under Turbopack | Spike first; fallback to prebuilt assets is specified |
| Two Monaco instances (GraphiQL and this page) conflict | They live on different routes; the spike navigates between both pages |
| Large output makes the panel slow | The run hook requests only the missing tail; the panel renders plain text |

## Security Considerations

- Output and results are rendered as text, never as HTML.
- Draft files stay in memory; nothing is written to browser storage.

## Next Steps

Phases 6 and 7 add a Packages status and Triggers and Variables tabs to this workbench.
