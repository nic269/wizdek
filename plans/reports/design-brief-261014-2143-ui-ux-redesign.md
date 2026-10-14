# Shopify Toolkit: UI/UX redesign brief

This brief is for a designer (Claude Design) redesigning and improving the UI and UX of the Shopify Toolkit web app. It covers what the product is, who uses it, every screen, the main flows, the states each screen must handle, the current visual system, and the technical limits that a design has to respect.

## 1. Product in one paragraph

Shopify Toolkit is an internal tool for development teams that look after many Shopify stores at once. Inside an organization, a developer connects Shopify stores, runs Shopify Admin GraphQL against any store from a console, builds automations ("flows") on a node canvas and runs them against a store with a full per-step, per-item trace, and backs up PostgreSQL databases. The work is technical and sometimes high-stakes: flows and mutations change live store data, and database backups contain production data.

## 2. Users and context

| Aspect | Detail |
|--------|--------|
| Primary user | A developer or technical operator at an agency or in-house team that manages many Shopify stores |
| Secondary users | Team admins, who manage members, roles and connections, and viewers, who only read |
| Usage | Desktop, in long working sessions next to code and the Shopify admin. Mobile only needs to stay usable, not optimal. |
| Tone | A precise, calm, trustworthy developer tool. It should feel dense but readable, closer to Linear, Vercel or Supabase than to a marketing site. |
| Language | The UI copy is English. |
| Tenancy | Everything belongs to an organization, and the user switches the active organization from the sidebar. |

## 3. Goals for the redesign

1. Give the app a clear, distinctive, consistent visual identity on top of the current shell, rather than the default shadcn look.
2. Replace the placeholder dashboard with a real overview: stores and their health, recent flow runs and failures, recent backups, and quick actions.
3. Make the core workflows faster and clearer, especially connecting a store, building and running a flow, and reading a run's trace.
4. Make risk visible. Mutations, running flows against a store, and database backups should clearly signal which store or database they will affect.
5. Design every state with care: empty, loading, error, read-only (no permission), and partial failure.
6. Bring the auth pages (sign-in, sign-up, password recovery, email verification, invitation) into the same visual language. They still use an older centred-card layout.

## 4. Fixed technical constraints

- **Stack:** Next.js App Router, React, Tailwind CSS v4, and shadcn/ui components built on **Base UI** (`@base-ui/react`, not Radix). Icons are Lucide.
- **Every control must be a shadcn component.** Native `<select>`, `<input type="checkbox">` and similar elements are not allowed. Designs should use what shadcn offers, and missing shadcn components can be added.
- **Available components:** accordion, alert, alert-dialog, avatar, badge, breadcrumb, button, button-group, calendar, card, chart, checkbox, collapsible, combobox, command, context-menu, dialog, drawer, dropdown-menu, empty, field, hover-card, input, input-group, input-otp, item, kbd, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner (toasts, currently unused), spinner, switch, table, tabs, textarea, toggle, toggle-group and tooltip.
- **Light theme only.** Dark mode is out of scope for now, but tokens should be named so dark values could be added later.
- **Theming is through CSS variables** (shadcn tokens plus a few shell tokens, see section 8). A redesign should be expressible as new token values plus component class changes.
- **Embedded third-party UIs:** the GraphQL console embeds **GraphiQL** (editor, Explorer, docs and history plugins). The flow builder uses **React Flow** (`@xyflow/react`) for the canvas. Both can be restyled with CSS, but their structure is fixed.

## 5. App shell (current)

The shell follows the Meldmark product layout:

- A **left sidebar** on a light grey canvas (`#f3f3f3`). It has the brand at the top, a navigation list with icons, a ⌘K search button that opens a dialog to jump to any destination, and a footer holding the **organization switcher** (a select) and the **account menu**. The account menu has the user's avatar initials, name and email, and offers Settings and Sign out.
- The sidebar **collapses** to an icon rail, and the collapsed state is remembered.
- On mobile the sidebar becomes a top bar with a menu button that opens a sheet.
- **Content** sits in one white panel with a 12px radius and a hairline border on the grey canvas. On desktop only this panel scrolls.
- Each page starts with a **page header**: a 26px semibold title, a 15px muted description, actions on the right, and a hairline rule below.

Navigation order: Dashboard, Stores, GraphQL, Flows, Database, Settings, Members, Access.

## 6. Screens

### Signed out

| Route | Purpose | Contents |
|-------|---------|----------|
| `/sign-in` | Sign in | Email and password, links to sign up and forgot password |
| `/sign-up` | Create an account | Name, email, password |
| `/forgot-password` | Request a reset link | Email, then a confirmation message |
| `/reset-password` | Set a new password | New password |
| `/verify-email` | Email verification result | A status message |
| `/invite/[token]` | Accept an organization invitation | The organization name and an Accept button. The user signs in first if needed. |

### Signed in

| Route | Purpose | Main content | Key actions |
|-------|---------|--------------|-------------|
| `/dashboard` | Home | Today, boilerplate leftovers: an organizations card (list and create) and two placeholder cards ("API: Check status", "Providers: Graceful"). **Needs a real design.** | Create organization |
| `/stores` | Connected stores | A table with the columns Store (domain and name), Status badge, Scopes, Last check and Actions, plus a webhook-secret indicator with an inline form | Connect store, Shopify apps, Check health, Disconnect, Save webhook secret |
| `/stores/new` | Connect a store | Three tabs, one per method: **Access token** (domain and token), **App credentials** (pick a registered app, one domain per line, with a result per domain), **OAuth install** (pick an app, enter a domain, continue to Shopify) | Connect, Continue to Shopify |
| `/stores/apps` | Registered Shopify apps | A list of apps with a create and edit form: name, client ID, client secret (write-only), scopes, install link, and token mode (non-expiring or expiring) | Add app, Edit, Delete (blocked while stores use the app) |
| `/stores/oauth/callback` | OAuth return | Progress, then the result of completing the install | Go to stores |
| `/graphql` | GraphQL console | A toolbar with a store select (connected stores only), an API version select and a "Return detailed cost" checkbox. GraphiQL fills the rest: an editor with tabs, variables and headers, a response pane, and a sidebar with the Explorer, docs, history and **Saved queries** (shared across the organization). A status bar under the response shows the HTTP status, GraphQL errors, user errors, requested and actual cost, throttle state and request ID. | Run, Save query, switch store or version |
| `/flows` | Flow list | A create-flow input and button, then a table with the columns Flow (renamable inline), Status badge (Draft, Active, Archived), Last run and Updated. Archived flows are hidden behind a toggle. | Create, Rename, Archive or Restore, Open |
| `/flows/[flowId]` | Flow builder | A header with a back link, the flow name, a status badge, the version, a read-only badge, an unsaved-changes note, and the buttons Validate, Runs, Save, Run and Activation. Below it are three columns: the **node palette** (left), the **canvas** (centre), and the **settings panel** for the selected node (right). A validation panel lists issues and jumps to the node. Dialogs: **Run** (pick a store and fill the trigger's inputs, such as uploading a CSV), **Activation** (for webhook and schedule triggers: pick a store, then activate or deactivate), and a **save conflict** dialog. | Add, connect and configure nodes; Validate; Save; Run; Activate |
| `/flows/[flowId]/runs` | Run history | A table of runs with the columns Status, Store, Started, Started by, Duration and Items | Open run |
| `/flows/[flowId]/runs/[runId]` | Run trace | The run status and its summary. The trace shows each step with its status and per-status item counts. An **items panel** filters items by status and shows each item's input, output and error. The page polls while the run is active. | Cancel run |
| `/database` | Database connections | A table with the columns Connection, Database, a reachability badge, and Last backup | Add connection, Open |
| `/database/new` | Add a connection | A name and a database URL (secret, never shown again) | Save connection (it is tested first) |
| `/database/[connectionId]` | Connection detail | A connection card (engine, host, database, server version), an edit form, and a backups table: status (Queued, Running, Completed, Failed), size, times and failure reason | Back up now, Download, Delete backup, Edit, Delete connection |
| `/settings` | Settings | Empty today ("No settings yet"). It could hold profile and organization settings. | |
| `/settings/members` | Members and invitations | Organization select, member list, invite form, pending invitations | Send invite, Revoke invitation, Load more |
| `/settings/access` | Roles and permissions | Organization select, members with a role select each, roles with permission checkboxes grouped by resource, and an **audit log** with an event filter | Change role, Create or edit a custom role, Filter the audit log |

## 7. Core workflows to optimise

1. **First run.** Sign up, create an organization, register a Shopify app or paste a token, connect the first store, then run a first query. Today nothing guides this sequence, and an onboarding checklist on the dashboard would help.
2. **Connect a store.** The user picks one of three methods. Help them choose: the access token suits a custom app in the store, app credentials suit a store in the same Shopify organization as the app, and OAuth suits any other store. For OAuth, the redirect URL must be copied into the Shopify app.
3. **Query a store.** Pick a store and API version, write or explore a query, run it, and read the cost and errors. Mutations change live data, so the selected store must be unmistakable.
4. **Build a flow.** Example: a manual trigger with a CSV upload, then Parse CSV, Find order, If total > 1000, and Add tags on the true branch. The parts are the palette, the canvas, node settings with template fields (`{{ $json.Total }}`), validation, save (each save is a new version), and run.
5. **Read a run.** Answer quickly what happened: how many items succeeded, failed or are unknown at each step, and why each one failed. An item marked **Unknown** needs a human to check the store, and that state should stand out.
6. **Back up a database** before a deploy: open the connection, choose Back up now, watch the status, then download the file.

## 8. Domain states to design for

| Entity | States |
|--------|--------|
| Store | Pending, Connected, Reconnect required, Disconnected |
| Store credential | Access token, OAuth, App credentials |
| Flow | Draft, Active, Archived |
| Flow run | Queued, Running, Succeeded, Partially failed, Failed, Canceled |
| Run step | Pending, Running, Succeeded, Failed, Skipped |
| Run item | Pending, In progress, Succeeded, Failed, Unknown (the effect may or may not have been applied) |
| Flow activation (webhook or schedule) | Active or inactive per store |
| Database backup | Queued, Running, Completed, Failed |
| Database connection | Reachable, Unreachable |

Status needs one consistent badge system with clear semantic colours (success, warning, danger, neutral, in progress) that stay readable in a dense table.

**Permissions change the UI.** A user without the needed permission sees read-only views: the flow canvas is read-only, and buttons such as Save, Connect and Back up are hidden. Viewers cannot open the GraphQL console. Each of these cases needs a deliberate empty or read-only design rather than a missing button.

**Generic states on every data screen:** loading (currently a text "Loading …" state), empty (`EmptyState` with a title and description), "No organization" (the user has none yet), and an error (an inline destructive alert). Toasts exist but are not used. Mutation feedback today is inline text such as "Saving...".

## 9. Current visual system

| Token | Value |
|-------|-------|
| Font | Albert Sans (UI), Geist Mono (code) |
| Base radius | 4px for controls; 12px for the content panel; 8px for menus |
| Foreground / primary | `#262626` (near-black primary buttons) |
| Muted foreground | `#595959` |
| Canvas (behind the panel) | `#f3f3f3` |
| Surface / card | `#ffffff` |
| Border / hairline | `#e6e6e6`, with control borders at `#d9d9d9` |
| Hover (nav) | `#e8e8e8` |
| Destructive | `#a3211a` |
| Avatar | `#e9e3dc` background, `#5a4636` text |
| Page title | 26px semibold, -0.01em tracking; description 15px |

The look today is neutral and monochrome, with almost no brand colour. Status badges use the stock shadcn variants (default, secondary, outline, destructive), so success and warning have no colour of their own.

## 10. Known UX issues and opportunities

- **Dashboard:** placeholder boilerplate content with no product value.
- **Settings:** an empty page.
- **Auth pages:** an older layout that does not match the shell.
- **Flow builder header:** too many equal-weight controls in one row (Validate, Runs, Save, Run, Activation). It needs a clear primary action, save state, and version history.
- **Flow nodes:** they show the node name and an issue count. They could show type icons, category colour, and a configured or not-configured state.
- **Run trace:** it should read as a step-by-step timeline or graph with counts, so that failures and unknown items are easy to find. Visualising the run on the canvas itself is one option.
- **Stores table:** health, scopes and the webhook secret are cramped into one table, and the inline webhook-secret form is awkward. A store detail drawer or page would help.
- **Connect store:** the three methods sit in tabs with no guidance on which to choose.
- **Risk signalling:** the store and database being acted on should always be visible and prominent in the GraphQL console, Run dialog, and backup actions.
- **Feedback:** only inline "Saving..." text and alerts. Toasts and progress for long-running work (runs, backups) are opportunities.
- **Secrets:** tokens, client secrets and database URLs are write-only and never shown again. Forms should say this clearly.
- **GraphQL console:** a desktop tool. It should look native inside the shell and fit the 12px panel cleanly.

## 11. What we want from the design

1. A refined visual language: colour, including a restrained accent and semantic status colours; type scale; spacing; radius; elevation; and badge, table and form patterns. Express it as CSS token values plus component guidelines.
2. High-fidelity designs, in priority order:
   1. Dashboard (overview and onboarding).
   2. Flow builder, including node design, header and settings panel.
   3. Run trace.
   4. Stores list and connect store.
   5. GraphQL console chrome.
   6. Database connection detail.
   7. Settings: access and members.
   8. Auth pages.
3. Empty, loading, error and read-only variants for the main list screens.
4. Mobile behaviour of the shell and the list screens. Desktop is the priority.

**Non-goals:** dark mode, new product features beyond what is listed, marketing pages, and replacing GraphiQL or React Flow.
