---
phase: 6
title: "Phase 6: Database UI"
status: todo
priority: P1
effort: "1.5d"
dependencies: [5]
---

# Phase 6: Database UI

## Context Links

- Navigation: `packages/config/src/navigation.ts`, `packages/config/src/navigation.test.ts`, icons in `apps/app/app/app-shell-layout.tsx`
- List-and-form pattern: `apps/app/app/stores/page.tsx`, `stores-panel.tsx`, `stores/new/connect-store-form.tsx`, `store-labels.ts`
- Polling pattern: `apps/app/app/flows/[flowId]/runs/runs-panel.tsx` (`refetchInterval` while active)
- Active organization: `apps/app/app/lib/active-organization.tsx`
- End-to-end tests: `tests/e2e/`, `tests/fixtures/`, `playwright.config.ts`

## Overview

Add the Database page: a list of connections, a form to add one from a URL, and a per-connection page whose first tool is Backups.

## Key Insights

- The page must leave room for later tools. A connection detail route with a tool section per feature does that without building a tool framework now.
- The stores UI already solves the same problems: organization-scoped list, permission-dependent actions, a secret field that is never shown again, status labels.
- Backups run for minutes. The runs panel already polls only while something is active.

## Requirements

- Navigation entry **Database** at `/database`, with an icon, placed after Flows.
- `/database`: connection list (name, engine, host, database, last check, last backup time and status) with **Add connection**. Empty state explains what a connection is.
- `/database/new`: name and URL fields. The URL field is masked like a password with a reveal toggle and is never pre-filled. When the URL's host is `localhost`, `127.0.0.1` or `::1`, show a note that this only works where the toolkit's API runs on the same machine as the database or a tunnel to it. An unsupported scheme shows which engines are supported.
- `/database/[connectionId]`: connection summary with **Check connection**, **Edit**, **Delete**; a **Backups** section with **Back up now** and a history table (started, status, size, duration, versions, **Download**, **Delete**). A failed backup shows its reason.
- The history polls while any backup is queued or running, and stops otherwise.
- Actions the user lacks permission for are hidden; a user with no `databases:read` sees the standard no-access state.
- Delete actions ask for confirmation. Deleting a connection says its finished backups are kept.

## Related Code Files

- Modify: `packages/config/src/navigation.ts`, `packages/config/src/navigation.test.ts`
- Modify: `apps/app/app/app-shell-layout.tsx` (icon for `/database`)
- Create: `apps/app/app/database/page.tsx`, `connections-panel.tsx`, `database-labels.ts`
- Create: `apps/app/app/database/new/page.tsx`, `new/connection-form.tsx`
- Create: `apps/app/app/database/[connectionId]/page.tsx`, `connection-detail.tsx`, `backups-panel.tsx`, `edit-connection-dialog.tsx`
- Create: `tests/e2e/database.spec.ts`

## Implementation Steps

1. Add the navigation entry and its test expectation, and the icon mapping.
2. Build the list page and panel from the stores panel's structure, using the API client the stores pages use.
3. Build the connection form. Detect the scheme and the local-host case in the browser for the notes only; the server remains the authority on validity. Show the server's error message on failure.
4. Build the detail page and the backups panel with conditional polling. Format size and duration with existing helpers where they exist.
5. Wire **Download** as a normal link to the download route so the browser handles a large file itself, not a fetch into memory.
6. Read which permissions the current member holds the same way the stores pages do, and hide actions accordingly.
7. End-to-end test against the real stack and test database: sign in as an owner, add a connection with the test database URL, back it up, wait for Completed, download and check the file is non-empty, delete the backup, delete the connection. A second test signs in as a Member and confirms the page shows no data and no actions.
8. Check the pages at phone width and in dark mode, and run the keyboard path through the form and the confirmation dialogs.

## Todo

- [x] Navigation entry, test and icon
- [x] Connection list page
- [x] Add-connection form with local-host and unsupported-engine notes
- [x] Connection detail with check, edit, delete
- [x] Backups panel with polling, download, delete
- [x] Permission-dependent visibility (connection page checks permissions on the server, like the flow builder; the list page shows the API's no-permission message, like the stores page, because the app has no endpoint for the current member's permissions)
- [x] End-to-end tests (owner flow, member no-access)
- [x] Responsive, dark mode and keyboard pass

## Success Criteria

- `pnpm --filter @repo/config test` passes.
- `pnpm test:e2e:db` passes with the new spec.
- `pnpm check:ci` and `pnpm check-types` pass.
- In the browser's network panel, no response on these pages contains the URL or password after the connection is saved.

## Risk Assessment

- **The end-to-end run needs `pg_dump` on the machine.** Same requirement as phase 4, already met in CI by phase 1.
- **Polling keeps running after the tab is hidden.** Follow the existing runs panel behaviour; do not invent a second policy.

## Security Considerations

- The URL field is cleared after a successful save and is never rendered back.
- The edit dialog asks for a new URL without showing the old one; leaving it blank keeps the stored one.

## Next Steps

Phase 7 documents the feature and runs the release check.
