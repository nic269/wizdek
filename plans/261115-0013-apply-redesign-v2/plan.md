---
title: Apply wizdek redesign v2 ("Hairline") to the app
status: done
created: 2026-11-15
source: https://claude.ai/artifact/5bjnCpq7XizaKe1q8sFJT9 (Design canvas, version 1794675252-a25e)
brief: docs/design/wizdek-redesign-v2-brief.md
scout: plans/reports/scout-261114-2009-layout-redesign-summary.md
---

# Apply redesign v2 to `apps/app` and `@repo/design-system`

## Outcome

The running app matches the approved v2 canvas. That means the Hairline tokens, the new sidebar information architecture with a collapsed rail and flyouts, and a header owned by the shell. Every screen on the canvas follows the shared patterns.

## Constraints

- Behaviour, data and APIs do not change. This is a visual and structural change only (brief §12 non-goals).
- Every control stays a shadcn/Base UI component. GraphiQL and React Flow are restyled with CSS only.
- Accessible names used by E2E specs stay. Any rename is listed in the change list at the end of this plan.
- Fonts: Albert Sans for all UI text. Geist Mono only for code and JSON: code blocks, editors, log lines, cron expressions.
- Light theme only. Tokens are named so a dark set can be added later.

## Non-goals

- New features, dark mode, and any change to OMS or flow behaviour.

## Acceptance criteria

1. Token values match `wz.css` on the canvas: canvas, ink, cobalt accent, status, production red, staging teal, radii 7/10/12/14.
2. The sidebar has groups Shopify (Stores, Metafields, GraphQL console), Automation (Flows), Data (Database), Works (OMS management) and Organization (Settings, Members, Access).
   - `/shopify` and `/works` redirect to their single tool.
   - The collapsed rail shows the icon logo with the version under it.
   - Hovering the logo shows an expand button with the tooltip "Expand navigation ⌘B", and ⌘B toggles the rail.
   - Groups with more than one item open a dark flyout. Single items show a tooltip.
3. Every signed-in page uses the shell header (`ShellHeader`) for breadcrumb, title or tabs, context chip and actions. Production targets get the red ring and the production strip.
4. Status badges are a dot plus a label, and Unknown is the only solid badge. Environment tags: production is solid red, staging is tinted teal.
5. `pnpm check-types`, `pnpm check:ci`, unit tests and the nav test pass. The canvas screens have been visually checked in the browser.

## Phases

| # | Phase | Main files | Status |
|---|---|---|---|
| 1 | Tokens and type: Hairline values; sans labels; mono only for code | `apps/app/app/theme.tweakcn.css`, `packages/design-system/src/styles/wizdek-tokens.css` | done |
| 2 | Shared components: badge, env tag, context chip, header, tabs, production strip | `packages/design-system/src/components/*` | done |
| 3 | Shell and IA: nav groups, rail, flyouts, ⌘B, hub redirects | `app-shell.tsx`, `navigation.ts` (+ test), `shell/*`, `shopify/page.tsx`, `works/page.tsx` | done |
| 4 | OMS management adopts the shared patterns | `works/oms-management/_module/components/*` | done |
| 5 | Metafields: list, create many, copy | `shopify/metafields/*` | done |
| 6 | Flows: builder header, palette, nodes, run dialog, trace | `flows/**` | done |
| 7 | Dashboard, Stores, GraphQL, Database | the matching route folders | done |
| 8 | Settings, Auth, shared states | `settings/*`, `(auth)/*`, `state.tsx` | done |
| 9 | Verify: types, lint, tests, visual pass | — | done |

## Accessible-name changes

These are recorded as phases land.

| Before | After | Where |
|---|---|---|
| "Collapse sidebar" / "Expand sidebar" | "Collapse navigation" / "Expand navigation" | shell |
| Nav "GraphQL" | "GraphQL console" | sidebar |
| Nav "Shopify" and "Works" hub links | removed; `/shopify` and `/works` redirect to their tool | sidebar |
| Env tag text "PROD" / "STAGING" | "Prod" / "Stag" (full name in the tooltip) | `EnvTag` |
| OMS tab "Settings" | "Site config"; its sub-tabs are "Maintenance", "Cron jobs", "Tools" | OMS management |
| Stores header button "Shopify apps" | page tab link "Shopify apps" in a `nav` named "Stores sections" (same name, with the app count) | Stores |
| Flow builder "← Flows" back link | breadcrumb link "Flows"; the flow name stays an `h1` | Flow builder |
| Shopify apps "Stores" back link | page tab link "Stores" in "Stores sections" | Shopify apps |
| Metafields "Resource" select | "Resource" list of buttons; the store select moved into the header | Metafields |
| Run trace "← Runs" back link | breadcrumb link "Runs"; "Run #n" stays an `h1` | Run trace |
| GraphQL page heading "GraphQL" | "GraphQL console" (`h1` in the breadcrumb) | GraphQL console |
| Dashboard buttons "New query" / "New flow" | removed; the header has "Connect store" and "Open console" | Dashboard |
| Database detail "← Database" back link | breadcrumb link "Database" | Database detail |
| OMS logs "Auto-refresh" checkbox | "Auto-refresh" switch (same label) | OMS debug logs |
| OMS Tools horizontal tabs | vertical tab list named "Tools" (same tab names) | OMS Tools |
| OMS panel "Cronjob" | "Cron jobs" | OMS Site config |
| Flows "Show archived (n)" / "Hide archived" button | tabs "All", "Active", "Drafts", "Archived" in a `nav` named "Flow status" | Flows list |
| Sidebar `nav` "Primary" | `nav` "Main"; group headings are buttons with `aria-expanded` | shell |
| "Search or jump to…" button | "Search and commands" | shell |
| Env tag text "Prod" / "Stag" | "Production" / "Staging"; the short form stays in dense rows (`compact`) | `EnvTag` |
| No-organization button "Create" | "Create organization"; the field has a visible "Organization name" label | shell |
| OMS logs "Reset filters" | "Clear"; search field is "Search runs"; "Refresh runs" removed (header Refresh) | OMS debug logs |
| OMS logs "Previous" / "Next" | "Newer" / "Load older" | OMS debug logs |
| OMS tabs `nav` "OMS management" | "OMS sections" | OMS management |
| Metafields row buttons "Edit …" / "Delete …" | menu button "Actions for …" with "Edit" and "Delete" | Metafields |
| Metafields "Copy selected (n)" | "Copy to store" (header and bulk bar) | Metafields |
| Run dialog "Run on …" | "Start n run(s)" | Flow run dialog |

## Verification (2026-11-15)

- `pnpm check:ci`, `pnpm check-types`, `pnpm test:unit` (24 tasks) and `check:oms-isolation` pass.
- OMS E2E harness: 20 of 20 pass.
- Checked in the browser: shell (expanded, rail, flyouts, ⌘B), Dashboard, Stores, Flows list, Settings.
- Second pass: Metafields, GraphQL console and the expanded sidebar logo checked in the browser.
- Third pass (full canvas check): Dashboard checklist and store health, Stores page tabs, Database detail, OMS overview, logs, run detail, Tools and Site config layout, Flows status tabs, Access layout and Auth split. Lint, types, unit tests, isolation and the OMS E2E harness (20 of 20) pass again; the OMS run caught a Panel header overlap, now fixed.
- Not checked visually: the flow builder canvas, the run trace, the run dialog and the OMS screens with live data, because the review account has no flows, stores or OMS access. The root `tests/e2e` suite was not run.

## Canvas audit (2026-11-15, second session)

The canvas was unchanged (same version), so this pass compared every artboard with the code and closed the gaps.

- Shell: 240px sidebar, collapsible groups, logo links to Dashboard, warning count pill, organization and account rows, no-organization state, flat empty state.
- OMS: debug logs as a full-width tool (filter bar, runs list, run detail with metric grid and compact logs), cron rows and syntax help, operation history, typed-confirm dialog, empty connection state.
- Metafields: flush table, type tags, row menu, floating bulk bar.
- Flows: 240×64 nodes with a category edge, one-line palette, pill zoom controls, run dialog store list, run trace summary strip.
- `pnpm check:ci`, `pnpm check-types`, `pnpm test:unit`, `check:oms-isolation` and the OMS E2E harness (20 of 20) pass.
- Not checked with live data: Metafields table, flow canvas, run dialog and run trace (the review account has no stores or flows). The root `tests/e2e` suite was not run; three selectors in it were updated.
- Not built because no behaviour exists for it: bulk delete of definitions, the run dialog's store search, and the partial-start summary dialog.
