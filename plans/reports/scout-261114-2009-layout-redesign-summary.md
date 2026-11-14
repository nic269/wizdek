# Layout summary for redesign — Wizloft devkit (wizdek)

Date: 2026-11-14 · Scope: `apps/app` (Next.js App Router) + `packages/design-system`

## 1. Stack

- Next.js App Router, React, Tailwind CSS v4, shadcn/ui on Base UI, Lucide icons, Sonner, Sheet, AlertDialog, Command (⌘K).
- GraphiQL (GraphQL console) and React Flow (flow builder) are restyled with CSS, not replaced.
- Tokens: `packages/design-system/src/styles/wizdek-tokens.css`, `theme-contract.css`, `themes/default.tweakcn.css`, app override `apps/app/app/theme.tweakcn.css`. Fonts: Albert Sans (self-hosted) + Geist Mono.
- Current visual direction is "Paper" (light, `#f3f3f1` canvas, white content panel, near-black primary, indigo accent). A "Console" direction (dark sidebar, violet) exists only as tokens. Light mode only (`enableSystem={false}`).
- Prior redesign source of truth: `docs/design/design_handoff_wizdek_redesign/` (README + HTML prototype) and plan `plans/261014-2309-wizdek-redesign/`.

## 2. Layout skeleton

```
RootLayout (app/layout.tsx)
└─ DesignSystemProvider → Providers (react-query) → ActiveOrganizationProvider
   └─ AppShellLayout (app/app-shell-layout.tsx)   server: session check → redirect /sign-in
      └─ WizdekShell (app/shell/wizdek-shell.tsx) client: nav indicators, ⌘K, collapse state
         └─ AppShell (design-system/components/app-shell.tsx, 354 lines)
            ├─ Sidebar (≥820px): brand, collapse toggle, search (⌘K), nav groups, org switcher, account menu
            ├─ Mobile header (<820px): menu button → Sheet drawer, page title, search
            └─ Content panel: rounded-panel, bordered, bg-card, own scroll
               └─ Page width: default 1400px | narrow 1180px | full (no padding)
```

Key behaviours to keep:
- Sidebar collapse is persisted in `localStorage` (`wizdek.sidebar-collapsed`).
- Live nav indicators: Stores shows a warning count for `RECONNECT_REQUIRED`; Flows shows "N running" with a pulse.
- `NoOrganization` replaces content when the user has no organization (except `/works`, which sets `requiresOrganization={false}`).
- Single breakpoint at 820px switches sidebar ↔ mobile header.

## 3. Navigation (source: `packages/config/src/navigation.ts`)

| Group | Items |
|---|---|
| Workspace | Dashboard, Stores, Shopify, GraphQL, Flows, Database, Works → OMS management (nested) |
| Organization | Settings, Members (only if invitations enabled), Access |

Icons map in `apps/app/app/shell/nav.tsx`. Note: Shopify and Works share the `Boxes` icon; Database and OMS management share `Database`. Nav order is pinned by `packages/config/src/navigation.test.ts`.

## 4. Screens and their current layout

| Route | Width | Layout pattern | Main file (lines) |
|---|---|---|---|
| `/dashboard` | default | Overview cards + onboarding checklist | `dashboard/dashboard-overview.tsx` (758) |
| `/stores` | default | List + right Sheet drawer for detail | `stores/stores-panel.tsx` (417), `store-drawer.tsx` (592) |
| `/stores/new` | narrow | Connect form | `stores/new/connect-store-form.tsx` (688) |
| `/stores/apps` | default | Shopify apps list | `stores/apps/shopify-apps-panel.tsx` (518) |
| `/shopify` | default | Hub page: one link card (Metafields) | `shopify/page.tsx` |
| `/shopify/metafields` | default | Large tool panel: list, type picker, metaobject picker, cross-store copy | `metafields-panel.tsx` (922), `copy-definitions.tsx` (392) |
| `/graphql` | full | GraphiQL with custom toolbar, saved queries plugin, status bar | `graphql/graphql-console.tsx` (402) |
| `/flows` | default | Flow list | `flows/flows-panel.tsx` (508) |
| `/flows/[id]` | full | Canvas builder: node palette, React Flow canvas, node config panel, validation, version history, run dialog | `flow-builder.tsx` (538) + siblings |
| `/flows/[id]/runs` | default | Runs table | `runs/runs-panel.tsx` |
| `/flows/[id]/runs/[runId]` | full | Run trace: timeline + items panel, polling | `runs/[runId]/*` |
| `/database` | default | Connections list + backups | `connections-panel.tsx` (440) |
| `/database/[id]` | default | Connection detail + backups table | `connection-detail.tsx` (659) |
| `/works` | default | Hub page: one link card (OMS management) | `works/page.tsx` |
| `/works/oms-management/[[...view]]` | full | Own module UI: breadcrumb, environment select bar, tab-like nav, site config, logs, operations | `_module/components/management-app.tsx` (488) |
| `/settings`, `/settings/members`, `/settings/access` | default | Settings header with tabs; members table; roles, assignments, audit log | `settings/*` |
| `(auth)/*`, `/invite/[token]` | — | Split auth layout, outside the shell | `(auth)/auth-split.tsx`, `auth-form.tsx` |

## 5. Inconsistencies worth addressing in a redesign

1. **Hub pages are thin.** `/shopify` and `/works` each show a single `max-w-xl` link card. They feel empty and add a click. Options: turn them into tool grids, or move their tools into the sidebar directly (Shopify → Metafields is not in nav today).
2. **OMS management uses its own layout.** It renders `width="full"` but then pads itself (`p-6 lg:p-8`), uses a hand-written text breadcrumb, `rounded-xl` cards and ad-hoc tab buttons instead of the shared `PageHeader`, `SectionLabel`, `Tabs` and `Breadcrumb`. It is the screen that diverges most from Paper.
3. **Features added after the Oct redesign** (Shopify metafields, cross-store copy, multi-store flow runs, OMS) were not part of the handoff prototype, so their layouts were improvised. `metafields-panel.tsx` (922 lines) is the biggest single panel.
4. **Navigation depth is uneven.** Works has nested children in nav; Shopify does not; Stores → Apps and Flows → Runs are reachable only from inside pages. Breadcrumbs are not a shared shell feature.
5. **Duplicated icons** in the sidebar (see §3) make groups hard to scan when collapsed.
6. **Only one breakpoint (820px).** Full-width tools (flow builder, GraphQL, run trace) have no tablet-specific layout.
7. **No page-level header slot in the shell.** Each page renders its own `PageHeader`; full-width pages each build their own top bar.

## 6. Constraints to respect

- Public contracts: `AppShell` props, `Page` widths, nav order test, permission-gated items (`usePermissions().can(...)`).
- All controls must be shadcn components (no native select/checkbox), per the handoff.
- GraphiQL and React Flow stay; only their chrome and CSS change.
- Paper tokens are the default; any new direction should be a token swap (`.theme-console` pattern).
- E2E specs (`tests/`, OMS `_module/tests/e2e/`) rely on current labels and roles; layout changes must keep accessible names.

## Unresolved questions

- Is the goal a new visual direction, or a structural layout change (navigation/IA, shell regions), or both?
- Should hub pages (`/shopify`, `/works`) stay, or should tools be promoted into the sidebar?
- Should OMS management be brought fully into the shared shell patterns?
- Is dark mode or the Console direction now in scope?
