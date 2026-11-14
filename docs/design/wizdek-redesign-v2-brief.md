# Wizloft devkit (wizdek): redesign v2 brief — visual and structure

This brief is for a designer (Claude Design). It asks for a second redesign of the Wizloft devkit web app, covering **both the visual language and the structure** (navigation, shell regions, page layouts). It is self-contained: it describes the product, users, every screen, the states each screen handles, the current visual system, the structural decisions already made, and the technical limits a design must respect.

The expected output is a **high-fidelity HTML prototype** that we review before any production code is written.

## 1. Product in one paragraph

Wizloft devkit ("wizdek", formerly "Shopify Toolkit") is an internal tool for development teams that look after many Shopify stores. Inside an organization, a developer connects Shopify stores; runs Shopify Admin GraphQL against any store from a console; manages metafield definitions in bulk and copies them between stores; builds automations ("flows") on a node canvas and runs them against one or many stores with a per-step, per-item trace; backs up PostgreSQL databases; and operates an external order-management system (OMS) across staging and production. The work is technical and often high-stakes: flows, mutations and OMS operations change live data, and backups contain production data.

## 2. Users and context

| Aspect | Detail |
|---|---|
| Primary user | A developer or technical operator at an agency or in-house team managing many Shopify stores |
| Secondary users | Admins (members, roles, connections) and viewers (read-only) |
| Usage | Desktop, long sessions beside code and the Shopify admin. Mobile must stay usable, not optimal. |
| Tone | Precise, calm, trustworthy, dense but readable. Closer to Linear, Vercel or Supabase than a marketing site. |
| Language | UI copy is English |
| Tenancy | Everything belongs to an organization; the user switches the active organization in the sidebar |

## 3. What happened since the first redesign

A first redesign (Oct 2026) introduced the current "Paper" look and the shell. Since then the app grew features that were **not** part of that design and whose layouts were improvised:

- **Shopify → Metafields**: bulk create, edit and delete metafield definitions per store, metaobject reference pickers, and copying definitions to another store.
- **Flows across many stores**: the Run dialog can start a run against several stores in parallel.
- **New flow nodes**: Fetch customers, Export CSV, Set fields, Filter, Switch, Bulk mutation, Schedule and Webhook triggers.
- **Works → OMS management**: a whole sub-application (see §7) with its own environment switcher, logs, site config, cron jobs and risky operations.

The result: thin hub pages, uneven navigation depth, a sub-app that ignores the shared patterns, and a visual system that now feels generic.

## 4. Goals

1. **Visual:** propose a refreshed, distinctive visual language. You may evolve the current Paper direction or replace it. Express it as CSS token values plus component guidelines. Name tokens so a dark set can be added; showing a dark variant is welcome but optional.
2. **Structure:** redesign the information architecture and shell so every tool is one click from the sidebar, location is always clear, and full-screen tools (canvas, console, trace, OMS) share one consistent top-bar pattern.
3. Bring the post-redesign screens (Metafields, multi-store runs, OMS management) to the same quality and patterns as the rest.
4. Keep risk visible: the store, database or OMS environment an action will affect must be unmistakable, with production clearly distinguished.
5. Design every state: empty, loading, error, read-only (no permission), partial failure, no organization.

## 5. Structural decisions already made

These are decided. Design within them.

1. **Tools move into the sidebar.** The one-card hub pages `/shopify` and `/works` go away as destinations. The sidebar shows nested items: *Shopify → Metafields* and *Works → OMS management*. The parent item can be a collapsible group label rather than a page.
2. **The shell owns a breadcrumb / page-title bar.** Today every page builds its own header and full-width pages each build their own top bar. The new shell should provide one consistent header region (breadcrumb, title, primary actions, context such as the selected store or environment) that both padded and full-width pages use.
3. **OMS management adopts the shared patterns** — shared page header, tabs, breadcrumb, section labels, badges and form controls — instead of its hand-built breadcrumb, tab buttons and cards. Its behaviour does not change.
4. Sub-pages that today are reachable only from inside a page (Stores → Shopify apps, Flow → Runs) should get a clear, consistent place (tabs, sub-nav, or nested sidebar items — your call).

## 6. Fixed technical constraints

- **Stack:** Next.js App Router, React, Tailwind CSS v4, shadcn/ui on **Base UI** (`@base-ui/react`, not Radix), Lucide icons.
- **Every control is a shadcn component.** No native `<select>` or `<input type="checkbox">`. Available: accordion, alert, alert-dialog, avatar, badge, breadcrumb, button, button-group, calendar, card, chart, checkbox, collapsible, combobox, command, context-menu, dialog, drawer, dropdown-menu, empty, field, hover-card, input, input-group, input-otp, item, kbd, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip.
- Toasts: Sonner. Right-side drawers: Sheet. Confirmations: Dialog / AlertDialog. ⌘K: Command.
- **Theming via CSS variables** (shadcn tokens plus shell tokens). A redesign must be expressible as token values plus component class changes.
- **Embedded third-party UIs stay:** GraphiQL (editor, Explorer, docs, history, a custom Saved queries plugin) in the GraphQL console, and React Flow (`@xyflow/react`) for the flow canvas. Restyle with CSS only; structure is fixed. A prototype may imitate them to design the chrome.
- Accessible names (button labels, field labels, landmark names) are used by end-to-end tests. Keep labels meaningful; renaming is fine if you list the changes.
- Permission-gated UI is real: the design must show what a viewer sees, not just hide buttons.

## 7. Screens

### Shell (current)

- Left sidebar on the canvas colour: brand ("Wizloft devkit", meta line "wizdek · v2.4"), collapse toggle, ⌘K search button, nav groups, organization switcher and account menu at the bottom. Collapses to an icon rail (remembered).
- Live nav indicators: **Stores** shows a warning count of stores needing reconnect; **Flows** shows "N running" with a pulsing dot.
- Below 820px the sidebar becomes a top bar with a menu button opening a Sheet.
- Content sits in one white panel (12px radius, hairline border) on the canvas; only the panel scrolls.
- Page widths: default 1400px, narrow 1180px, full (no padding) for canvas, console, trace, OMS.
- No organization yet → the content area shows a "create your first organization" state.

Current nav:

| Group | Items |
|---|---|
| Workspace | Dashboard, Stores, Shopify (hub), GraphQL, Flows, Database, Works (hub) → OMS management |
| Organization | Settings, Members (only when invitations are enabled), Access |

Known icon clashes: Shopify and Works share one icon; Database and OMS management share another.

### Signed out

| Route | Contents |
|---|---|
| `/sign-in`, `/sign-up` | Split layout: form on one side, brand panel on the other |
| `/forgot-password`, `/reset-password` | Email → confirmation; new password with strength meter |
| `/verify-email` | Code / status |
| `/invite/[token]` | Organization name, Accept (sign in first if needed) |

### Signed in

| Route | Purpose | Main content | Key actions |
|---|---|---|---|
| `/dashboard` | Home | Onboarding checklist (dismissible), Needs attention, Store health, Recent flow runs, Recent backups | Jump to each area |
| `/stores` | Connected stores | Table: store identity, status, scopes, last check; detail in a right Sheet (health, scopes, webhook secret, disconnect) | Connect store, Check health, Disconnect |
| `/stores/new` | Connect a store | Three methods with guidance: Access token, App credentials (many domains, result per domain), OAuth install | Connect, Continue to Shopify |
| `/stores/apps` | Registered Shopify apps | List + form: name, client ID, client secret (write-only), scopes, install link, token mode | Add, Edit, Delete (blocked while in use) |
| `/stores/oauth/callback` | OAuth return | Progress then result | Go to stores |
| `/shopify/metafields` | Metafield definitions | Store picker; searchable, selectable table of definitions grouped by resource (product, variant, customer, order…); multi-row "Create definitions" editor (name, namespace.key, type picker, metaobject reference picker, validations); edit drawer; bulk delete with control over existing values; **Copy definitions to another store** (choose destination store, map metaobject references, per-definition result) | Create in bulk, Edit, Delete, Copy to store |
| `/graphql` | GraphQL console | Toolbar: store select, API version select, "Return detailed cost". GraphiQL below with tabs, variables, headers, response, plugin rail (Explorer, Docs, History, Saved queries shared across the org). Status bar: HTTP status, GraphQL errors, user errors, requested/actual cost, throttle, request ID | Run, Save query, switch store/version |
| `/flows` | Flow list | Create input; table: name (inline rename), status (Draft/Active/Archived), last run, updated; archived behind a toggle | Create, Rename, Archive/Restore, Open |
| `/flows/[id]` | Flow builder | Header: back, name, status, version, read-only badge, unsaved note, Validate, Runs, Save, Run, Activation, version history. Three columns: node palette, React Flow canvas, settings panel for the selected node. Validation panel. Dialogs: **Run** (one or **many stores**, trigger inputs such as CSV upload, partial start failure), Activation (webhook/schedule per store), save conflict | Build, Validate, Save (new version), Run, Activate |
| `/flows/[id]/runs` | Run history | Table: status, store, started, started by, duration, items | Open run |
| `/flows/[id]/runs/[runId]` | Run trace | Run summary; step timeline with per-status item counts; items panel filtered by status with input/output/error; polls while active | Cancel run |
| `/database` | DB connections | Table: connection, database, reachability, last backup | Add connection (Sheet), Open |
| `/database/[id]` | Connection detail | Connection card (engine, host, db, version), edit form, backups table (status, size, times, failure reason) | Back up now, Download, Delete backup, Edit, Delete connection |
| `/works/oms-management` | OMS operations (see below) | | |
| `/settings` | General | Your profile (name, email), Organization (name) | Save |
| `/settings/members` | Members | Member list, invite form, pending invitations | Invite, Revoke, Load more |
| `/settings/access` | Roles | Role per member, custom roles with permission checkboxes grouped by resource, audit log with event filter | Change role, Create/edit role, Filter |

### OMS management (sub-application)

Operates an external OMS. Everything happens against one selected **environment** (connection profile), which can be **staging or production**. Production must look and feel different (today: a "Production environment." note and typed confirmation "Type production to confirm").

- **Top bar:** breadcrumb (Works / OMS management / section), Environment select, Add connection, Refresh.
- **Sections:** Overview, Debug logs, Site config (Maintenance, Cron jobs, Tools).
- **Overview / diagnostics:** OMS API and Database health, available views, Recent failed workflows table.
- **Debug logs:** filters (search across run/batch/order/shop/error, status, module, feature, shop domain, actor ID, from date), auto-refresh (10s), Workflow runs list, and a run detail pane (summary: status, feature, target, actor, started, completed, duration, errors, warnings; run context; logs).
- **Site config → Maintenance:** maintenance mode with page exceptions (one path per line), Recent operations table (operation, status, revision, created, before/after diff), recovery for uncertain results, restore review.
- **Site config → Cron jobs:** per job: 5-field cron schedule with help, Run immediately, Save.
- **Site config → Tools:** Shopify custom apps (credentials, scopes, install links, available stores, Shopify API version, site timezone), Retrieve original import file (by workflow run ID), Review fraud risk (order preview then confirm), Replace webhook signature, Store credentials (revealed only on an audited request, hidden again after 15 s).
- **Connection editor:** display name, environment, API URL, service token (write-only), database host/port/name/user/password, SSL toggle.
- **States:** no connection yet, session not verified ("Sign in to continue"), view failed to load, no records.

## 8. Core workflows to optimise

1. **First run:** sign up → organization → register app or paste token → connect store → first query. Guided by the dashboard checklist.
2. **Connect a store:** choose the right method with guidance; OAuth redirect URL must be copyable.
3. **Query a store:** the selected store must be unmistakable; mutations change live data.
4. **Manage metafields:** pick a store, create many definitions in one pass, then copy them to another store and read per-definition results.
5. **Build and run a flow:** palette → canvas → node settings with template fields (`{{ $json.Total }}`) → validate → save (each save is a version) → run against one or many stores.
6. **Read a run:** per step, how many items succeeded, failed or are **Unknown** (effect may or may not have applied — needs a human), and why.
7. **Back up a database** before a deploy and download the file.
8. **Operate OMS safely:** pick the environment, find a failing workflow run in logs, inspect it, and perform a guarded change (maintenance, cron, credentials) — with production clearly signalled.

## 9. Domain states

| Entity | States |
|---|---|
| Store | Pending, Connected, Reconnect required, Disconnected |
| Store credential | Access token, OAuth, App credentials |
| Flow | Draft, Active, Archived |
| Flow run | Queued, Running, Succeeded, Partially failed, Failed, Canceled |
| Run step | Pending, Running, Succeeded, Failed, Skipped |
| Run item | Pending, In progress, Succeeded, Failed, **Unknown** (must stand out) |
| Flow activation | Active / inactive per store |
| Database backup | Queued, Running, Completed, Failed |
| Database connection | Reachable, Unreachable |
| OMS environment | Staging, Production |
| OMS operation | Pending, Completed, Failed, Uncertain (needs recovery) |

Flow node categories: **Triggers** (Manual, Schedule, Webhook), **Shopify** (GraphQL, Find order, Add tags, Fetch customers, Bulk mutation), **Data** (Parse CSV, Export CSV, Set fields), **Logic** (If, Switch, Filter). Nodes show type icon, category colour, configured / not configured and issue count.

Permissions change the UI: viewers get a read-only canvas, no Save / Connect / Back up, no GraphQL console, read-only OMS. Each needs a deliberate read-only design.

## 10. Current visual system ("Paper")

| Token | Value |
|---|---|
| Fonts | Albert Sans (UI), Geist Mono (code, meta) |
| Canvas + sidebar | `#f3f3f1` |
| Panel / card | `#ffffff` |
| Ink / secondary / muted / faint | `#1d1d1b` / `#3a3a37` / `#66665f` / `#93938b` |
| Hairline / control border | `#e9e8e4` / `#d9d8d3` |
| Sunken / hover | `#f8f8f6` / `#f3f3f0` |
| Primary button | near-black `#1d1d1b` |
| Accent | indigo `oklch(0.5 0.16 265)` (focus, selection, links) |
| Destructive | `#a3211a` |
| Radius | control 6px, card 10px, panel 12px, menu 8px |
| Status badge | pill 22px, dot + label; success green, warning amber, danger red, info blue (pulses when running), neutral grey; **Unknown is the only solid badge (orange)** |

An unused alternate "Console" direction exists as tokens only (dark sidebar, Geist, violet accent).

## 11. Known issues to solve

- Hub pages `/shopify` and `/works` are a single card each — replaced by sidebar nesting (§5).
- No shared header region; full-width tools each build their own top bar.
- OMS management looks like a different product (own padding, text breadcrumb, button "tabs", plain cards).
- Metafields is one very large panel; the create-many editor, the table and the copy flow compete for space.
- Run dialog for many stores: needs a clear store multi-select, a summary of what will run where, and a partial-start-failure state.
- Flow builder header still has many equal-weight controls.
- Duplicate sidebar icons; collapsed rail is hard to scan.
- One breakpoint only (820px); full-width tools have no tablet layout.
- Production vs staging (OMS) and live store context (GraphQL, flows, metafields) are signalled inconsistently.

## 12. What we want from the design

1. **Visual language:** colour (restrained accent, semantic status colours, a production / risk treatment), type scale, spacing, radius, elevation; badge, table, form, drawer and empty-state patterns. Delivered as CSS token values plus component guidelines.
2. **Structure:** sidebar IA with nested tools, the shared shell header (breadcrumb, title, actions, context), sub-navigation pattern, and responsive behaviour (desktop first, tablet for full-width tools, mobile usable).
3. **High-fidelity prototype screens**, in priority order:
   1. Shell + navigation (expanded, collapsed, mobile).
   2. OMS management: overview, debug logs with run detail, site config (maintenance, cron jobs, tools), connection editor — staging and production.
   3. Shopify → Metafields: list, create-many editor, copy to another store.
   4. Flow builder (header, palette, nodes, settings panel) and multi-store Run dialog.
   5. Run trace.
   6. Dashboard.
   7. Stores list + store drawer, connect store.
   8. GraphQL console chrome.
   9. Database list and detail.
   10. Settings: general, members, access.
   11. Auth pages.
4. Empty, loading, error, read-only and no-organization variants for the main list screens.
5. A short list of any accessible-name / label changes the design introduces.

**Non-goals:** new product features beyond what is listed, marketing pages, replacing GraphiQL or React Flow, changing OMS or flow behaviour.

## Reference

- First redesign handoff (tokens, status palette, prototype): `docs/design/design_handoff_wizdek_redesign/`
- Current shell: `packages/design-system/src/components/app-shell.tsx`
- Navigation config: `packages/config/src/navigation.ts`
