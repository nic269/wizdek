# Handoff: Wizloft devkit (wizdek) — UI/UX redesign

## Overview
This is a full visual and UX redesign of the internal tool formerly called "Shopify Toolkit", now **Wizloft devkit** (short name **wizdek**). It covers the app shell, Dashboard (overview and onboarding), Stores (list, detail drawer, connect, Shopify apps), the GraphQL console chrome, Flows (list, builder, run history, run trace), Database (list and detail), Settings / Members / Access, the auth pages, and every main list screen's empty, loading, error, no-organization and read-only states.

`original-brief.md` is the product brief the design answers. Read it for domain context: entities, states, routes and permissions.

## About the design files
Everything in `prototype/` is a **design reference built in HTML**. It shows the intended look and behaviour; it is not production code to copy. Recreate these designs in the existing codebase: **Next.js App Router, React, Tailwind CSS v4, shadcn/ui on Base UI (`@base-ui/react`), Lucide icons**. Use the codebase's established patterns.

- Every control must be a shadcn component. No native `<select>` or `<input type="checkbox">`. In the prototype, selects, checkboxes, switches, segmented controls and radio cards are hand-drawn. Map them to shadcn `Select`/`Combobox`, `Checkbox`, `Switch`, `ToggleGroup`/`Tabs` and `RadioGroup`.
- GraphiQL and React Flow stay. The prototype only *imitates* them so the chrome can be designed. Restyle the real libraries with CSS to match: tabs, rail, editor colours, node cards, handles, edges and controls.
- Use Sonner for toasts. Use Sheet for the right-side drawers. Use Dialog/AlertDialog for confirmations. Use Command for ⌘K.

**To view the prototype:** serve the `prototype/` folder (for example `npx serve prototype`) and open `Wizdek.dc.html`. The page shows a Tweaks panel only inside the design tool. Outside it, change the defaults in `Wizdek.dc.html` → `renderVals()` (`direction`, `role`, `dataState`).

## Fidelity
**High-fidelity.** Final colours, type, spacing, radii, copy and interactions. Recreate it pixel-close with shadcn + Tailwind tokens.

## Visual direction
There are two directions on one token set. **Paper is the chosen default.** Console is kept as an alternate theme so it can be added later as a token swap.

| | Paper (default) | Console (alternate) |
|---|---|---|
| Sans font | Albert Sans | Geist |
| Mono font | Geist Mono | Geist Mono |
| Sidebar | light, same as canvas `#f3f3f1` | dark `#16171a` |
| Primary button | near-black `#1d1d1b` | violet `oklch(0.5 0.2 292)` |
| Accent (focus, selection, links) | indigo `oklch(0.5 0.16 265)` | violet `oklch(0.53 0.2 292)` |
| Section labels | 11.5px/500, sentence case | Geist Mono 10.5px, uppercase, 0.07em |
| Control radius / panel radius | 6px / 12px | 5px / 10px |

## Design tokens (Paper)
Name them as shadcn CSS variables so dark values can be added later.

```css
:root {
  --font-sans: "Albert Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, Menlo, monospace;

  --background: #f3f3f1;        /* shell canvas + sidebar */
  --card: #ffffff;              /* content panel, cards, popovers */
  --foreground: #1d1d1b;        /* ink */
  --foreground-2: #3a3a37;      /* secondary ink (table values) */
  --muted-foreground: #66665f;  /* descriptions, meta */
  --faint: #93938b;             /* placeholders, line numbers */
  --border: #e9e8e4;            /* hairlines */
  --input: #d9d8d3;             /* control borders */
  --sunken: #f8f8f6;            /* table header, wells, side panels */
  --hover: #f3f3f0;             /* row hover */

  --primary: #1d1d1b;  --primary-foreground: #ffffff;
  --accent: oklch(0.5 0.16 265);      /* focus border, selected, progress */
  --accent-soft: oklch(0.955 0.025 265); /* focus ring (3px), selected row */
  --accent-ink: oklch(0.43 0.16 265); /* text links */

  --sidebar: #f3f3f1; --sidebar-foreground: #1d1d1b; --sidebar-muted: #6c6c65;
  --sidebar-hover: #e9e9e5; --sidebar-active: #ffffff;
  --sidebar-active-shadow: 0 0 0 1px #e3e2dd, 0 1px 2px rgba(0,0,0,.05);
  --sidebar-border: #e3e2dd; --sidebar-field: #fbfbfa;

  --destructive: #a3211a;
  --radius: 6px; --radius-card: 10px; --radius-panel: 12px; --radius-menu: 8px;
}
```

Console overrides: `--font-sans: Geist; --foreground:#141518; --foreground-2:#33353b; --muted-foreground:#5f6168; --faint:#8b8d94; --border:#e7e8eb; --input:#d6d8dd; --sunken:#f7f7f8; --hover:#f2f3f5; --primary: oklch(0.5 0.2 292); --accent: oklch(0.53 0.2 292); --accent-soft: oklch(0.95 0.03 292); --accent-ink: oklch(0.45 0.2 292); --sidebar:#16171a; --sidebar-foreground:#ececef; --sidebar-muted:#9a9ca5; --sidebar-hover:#222328; --sidebar-active:#2a2b31 (inset 0 0 0 1px #34353c); --sidebar-border:#2a2b30; --sidebar-field:#1d1e22; --radius:5px; --radius-panel:10px`. The shell canvas around the panel is dark too.

### Status palette (shared by both directions)
There is one `StatusBadge` everywhere. It is a pill: 22px tall, 8px horizontal padding, radius 999px, 12px/500 text, with a 6px dot and a 6px gap.

| Semantic | bg | text | dot | Used for |
|---|---|---|---|---|
| success | `#e8f4ec` | `#1f6b3f` | `#2f9e5c` | Connected, Succeeded, Completed, Reachable, Active |
| warning | `#fbf1db` | `#7a5410` | `#d39a1c` | Reconnect required, Partially failed |
| danger | `#fbeceb` | `#9b231c` | `#d1453b` | Failed, Unreachable |
| info / in progress | `#e9f0fb` | `#1f4f99` | `#3b7be0` | Running (dot pulses), Pending, In progress |
| neutral | `#f0f0ed` | `#55554f` | `#a3a39c` | Queued, Skipped, Canceled, Disconnected, Archived |
| **unknown** | `#e8590c` (solid) | `#ffffff` | `#ffffff` | Run item Unknown — the **only solid badge**, so it stands out |

Draft uses a white bg, a `--input` border, neutral text and a dot. Danger alerts use bg `#fdf3f2`, border `#f0c9c5` and text `#7d1d17`. Warning alerts use bg `#fdf7e8`, border `#ecd8a8` and text `#6a490c`. Unknown alerts use bg `#fff4ec`, border `#f6c7a7` and text `#8a3507`.

### Environment tags (risk signal)
These are mono 9.5px/600, 0.06em tracking, uppercase, padding 3px 5px, radius 3px. They always sit next to a store or database name.
- `PROD` bg `#fbeceb` text `#9b231c`
- `STAGING` bg `#e9f0fb` text `#1f4f99`
- `DEV` bg `#f0f0ed` text `#55554f`

(Environment isn't in the current data model. Add an `environment` enum on Store and DatabaseConnection, or derive it. Confirm with the team.)

### Flow node categories
Icon chip: 30px square, radius 8px, bg `oklch(0.95 0.035 H)`, icon `oklch(0.5 0.14 H)`.
- Trigger H=300 (violet)
- Data H=230 (sky)
- Logic H=75 (amber)
- Action H=160 (teal-green)

### Store identity colour
Each store gets a hue. Its 30px initials chip uses bg `oklch(0.95 0.035 H)` and text `oklch(0.5 0.13 H)`. The prototype hues are 25, 250, 70, 300 and 170. Derive them from a stable hash of the store id.

### Type scale
| Role | Size / weight / line-height | Notes |
|---|---|---|
| Page title | 24 / 600 / 1.15 | letter-spacing -0.02em |
| Page description | 14 / 400 / 1.5 | muted |
| Section title | 16 / 600 / 1.3 | |
| Card title | 14 / 600 / 1.2 | |
| Body | 14 / 400 / 1.5 | |
| Table cell / primary | 13.5 / 600 (name) or 400 | |
| Table header | 12 / 500 | muted, on `--sunken`, row 38px |
| Meta | 12 / 400 | muted |
| Section label | see direction table | |
| Mono (domains, ids, code) | Geist Mono 12–13 | |

### Spacing, sizes, elevation
- 4px base. Page padding is 28px top, 32px sides, 48px bottom. Content max-width is 1400px, centred.
- The page header has a 1px `--border` rule below it with 18px padding-bottom, and sections are 18–22px apart.
- Buttons are 34px tall in page headers and forms, 30–32px in toolbars and rows, and 28px for compact controls. Padding is 13–14px, and icons are 15px with a 7px gap.
- Inputs are 34px tall (38px on auth pages) with 10px horizontal padding. Focus state: border `--accent` plus a 3px `--accent-soft` ring.
- Table rows are 54–64px tall. Cards use a 1px `--border` and a 10px radius.
- Elevation:
  - Flat: hairline only.
  - Node: `0 1px 2px rgba(0,0,0,.05)`.
  - Popover: `0 14px 34px -10px rgba(0,0,0,.2)`.
  - Dialog: `0 24px 60px -12px rgba(0,0,0,.3)`.
  - Toast: dark `#1d1d1b`, radius 10px.

## App shell (`Wizdek.dc.html`)
- **Desktop:** a 244px sidebar on `--sidebar`, with a 14px/10px padding and a 14px gap between blocks. The content panel sits to its right with an 8px margin on the top, right and bottom, a white background, a 1px border, a 12px radius, and its own scroll.
- **Sidebar, top to bottom:**
  1. Brand row: 28px mark (radius 7px, bg `#1d1d1b`, white "w" 14/700), "Wizloft devkit" 14/600, "wizdek · v2.4" mono 10.5px muted, and a collapse button.
  2. **Organization switcher, moved to the top** (it was in the footer): a 24px org initials chip, the name, "5 stores · 4 members", and a chevrons icon. Opens a menu with the org list, a check on the active org, and "Create organization".
  3. Search button "Search or jump to…" with a `⌘K` kbd. Opens a Command dialog with Pages and Actions groups, arrow-key navigation and Enter.
  4. Nav groups with labels **Workspace** (Dashboard, Stores, GraphQL, Flows, Database) and **Organization** (Settings, Members, Access). Items are 32px tall with a 7px radius, a 16px Lucide icon and 13.5/500 text. The active item is a white raised pill (`--sidebar-active` plus its shadow). Optional trailing indicators: Stores shows an amber dot and the attention count. Flows shows a pulsing blue dot and "1 running".
  5. Footer: account button (30px avatar `#e9e3dc`/`#5a4636`, name, "Owner · wizloft"). Opens a menu with Settings and Sign out.
- **Collapsed:** a 60px icon rail. The state persists.
- **Under 820px:** a top bar with a 52px menu button, the mark, the page title and a search button. The sidebar becomes a left Sheet.
- **No organization:** the panel shows a centred empty state with an input and "Create", plus a note about invitations.

## Screens
The exact copy is in the prototype files. Use it verbatim.

### Dashboard (`Dashboard.dc.html`)
1. **Header:** an eyebrow date label, "Good evening, Anh", and a summary line. Actions: New query and New flow (secondary), Connect store (primary, hidden without permission).
2. **Onboarding checklist:** a card with a subtle `--sunken`→white gradient. Shows a progress bar (140px, accent fill) with "3/5" and a dismiss button. Five step cards sit in an auto-fit grid (min 190px):
   - Each card has a step number, a status circle, a title, a description and a CTA.
   - Done steps get an accent-filled check.
   - The **next step** gets an accent border and a primary CTA.
   - Future steps get a dashed circle and a secondary CTA.
3. **Two-column grid** (auto-fit, min 420px):
   - **Needs attention:** rows with a 28px tinted icon, a title, a description and a right-aligned accent-ink CTA. Ordered by severity: Unknown items, Reconnect required, Unreachable database, Missing webhook secret.
   - **Store health:** colour square, name with env tag, mono domain, and a status badge.
4. **Two-column grid:**
   - **Recent flow runs:** status badge, flow name, store and item summary, time, and a 6px stacked bar (success / failed / unknown / running).
   - **Recent backups.**
5. **States:**
   - Loading: shimmer skeletons.
   - Empty: an "All clear" state and a "No stores connected" state with a CTA.
   - Error: a danger alert with Retry.

### Stores (`Stores.dc.html`)
- **List:** header with "Shopify apps" (secondary, with a count) and Connect store (primary). Toolbar with a filter input (300px, search icon) and a segmented filter: All / Needs attention / Production, each with counts.
- **Table** (grid columns `minmax(240px,2.2fr) 130px 190px 90px 110px 110px`):
  - Store: initials chip, name, env tag, mono domain.
  - Connection: method icon and label (key-round = Access token, shield-check = OAuth, box = App credentials).
  - Status: badge plus "last checked".
  - Scopes: mono count.
  - Webhooks: "Secret set" (green check) or "Missing" (dashed circle).
  - Actions: a check-health icon button (spins while running, then a toast), plus either an amber **Reconnect** button or a chevron.
  - The whole row opens the drawer.
- **Store drawer (Sheet, right, 500px):**
  - Header: chip, name, env tag, domain, copy and external-link icons.
  - A warning alert when reconnect is required, with an inline CTA.
  - A 2×2 facts grid: Status, Last health check, Connection, API version.
  - A "Check health now" button.
  - **Access scopes** as mono chips. Write scopes are tinted amber (`oklch(0.96 0.03 60)` / `oklch(0.42 0.1 55)`), and a "+N more" button expands the rest.
  - **Webhook secret**: a write-only password field with a lock icon, Save, and the helper "Stored encrypted. Write-only — it's never shown again, only replaced." This replaces the old inline table form.
  - A danger-zone card that states the impact ("2 flows and 6 saved queries reference this store").
- **Connect a store:** back link, title, description. Main column plus a 300px sticky helper.
  - Section "1 · Method": three radio cards (icon chip, name, "best for" sentence, time cost). Selected: accent border plus a 3px soft ring, with a filled radio dot.
  - Section "2 · Details": a form card per method.
    - Access token: domain input with a `.myshopify.com` suffix addon, and a token password field with a lock. The button shows a spinner while it reads "Verifying with Shopify…".
    - App credentials: app picker and a domains textarea, one per line. After submit, a per-domain result list (check or x, with a message).
    - OAuth: an info well with the **redirect URL in a mono field plus a Copy button**, an app picker, a domain, and "Continue to Shopify ↗".
  - **"Which method?" helper:** three plain-language situations. Clicking one selects that method.
- **Shopify apps:** a card grid (min 380px). Each card shows the name, mono client_id, a token-mode chip, Stores/Scopes/"Encrypted" stats, Edit, and Delete. Delete is disabled with a reason while stores use the app. The register/edit form is a right Sheet with a write-only secret, scopes helper text and token-mode radio cards.

### GraphQL console (`GraphQL.dc.html`)
- **Toolbar:**
  - "GraphQL" title.
  - **Store picker (min 290px):** chip, name, mono domain, env tag. When the store is production the border is tinted `#e9b7b2` and the background `#fffafa`. Disconnected stores are listed but disabled.
  - API version select (mono).
  - "Detailed cost" switch.
  - "Saved queries sync to wizloft" note.
- **Production band:** a full-width strip, bg `#fbeceb`, text `#7d1d17`, reading "Production store. Mutations run here change live data on …".
- **GraphiQL restyle:**
  - 48px icon rail on `--sunken` (Saved, History, Explorer, Docs). The active icon gets a white raised tile.
  - 248px side panel with a filter. Saved queries are grouped "Shared in wizloft" and "Mine". Each row has a Q/M kind badge: Q = info colours, M = warning colours.
  - Editor tabs with kind badges.
  - Editor toolbar: Run button, `⌘↵` kbd, prettify, copy, Save.
  - Editor syntax colours:
    - keyword `oklch(.5 .19 300)`
    - operation name `oklch(.48 .15 255)`
    - variable `oklch(.52 .16 30)`
    - type `oklch(.5 .11 190)`
    - string `oklch(.5 .13 150)`
    - punctuation `#9a9a92`
  - Variables/Headers tabs.
  - Response pane on `--sunken`: "200 OK" badge and timing, plus an indeterminate accent bar while running.
  - **Status bar:** HTTP, GraphQL errors, User errors, Cost (requested · actual), Throttle, Request ID.
- **Run button colour:**
  - Query: accent.
  - Mutation on staging: amber `oklch(.55 .13 70)`.
  - **Mutation on prod:** `#a3211a`, labelled "Run mutation on PROD". It opens an AlertDialog that names the operation and shows a store card (PROD), with a "Run on Evisu HK" destructive button.
- **Viewer role:** a centred locked state explaining that `graphql:query` is needed, with See roles and Back to dashboard buttons.

### Flows (`Flows.dc.html`)
- **List:**
  - The header holds the inline "Name for a new flow" input and the Create flow button.
  - Table columns:
    - Flow: trigger icon chip, name, "trigger · N steps · vN".
    - Status: Active / Draft / Archived.
    - Last run: badge plus store and time.
    - Updated.
    - Actions: Runs icon and a ••• menu (Rename, Archive/Restore).
  - Archived flows are hidden behind a "Show archived (n)" toggle.
- **Builder:**
  - **Header hierarchy fix:** back link "Flows /", the name, a status badge, an optional Read-only badge, and a **save-state button** with a dot (amber "Unsaved changes · v7", green "Saved · v8 · just now"). The save-state button opens a **version history** popover.
  - Right side: ghost Validate (with an amber issue count) and ghost Runs, a divider, secondary **Save ⌘S**, and **primary "Run…"**. Activation (webhook/schedule only) goes in the Run dialog or a menu, not as another equal-weight button.
  - **Palette (236px):** a search box "Add a step…", category groups each with a colour square and label, and compact rows (26px icon chip, name, 2-line clamped description).
  - **Canvas:** `--sunken` with an 18px dot grid. Zoom controls sit bottom-left.
  - **Node card (216px):**
    - Top: category chip, mono uppercase category label in the category colour, and the title.
    - Footer strip: a config summary with a check, or a warning (amber bg `#fdf7e8`, text `#7a5410`, node border `#e8c77c`) when required fields are missing.
    - Handles: 11px, filled with the category colour. If nodes show labelled `true`/`false` outputs.
    - Selected: accent border plus a 3px soft ring.
    - Edges: `#b9b8b1`, 1.5px. The false branch is dashed.
  - **Settings panel (330px):**
    - Header: chip, title, description, close.
    - Fields: step name, resource segmented control, template fields shown as **accent-soft mono pills** (`{{ $json.order.id }}`), and a tags input with inline required validation.
    - "Fields from previous steps" chips copy a template on click.
    - Empty selection shows guidance and shortcuts.
  - **Validation popover:** bottom-left over the canvas, listing issues. Clicking an issue selects the node.
  - **Run dialog:**
    - Store radio cards. A selected prod card gets a red ring.
    - Trigger inputs: a CSV file row with Replace.
    - A risk callout naming the domain and the maximum number of items affected.
    - The confirm button reads "Run on <store>". It is red for prod and primary otherwise.
  - Read-only: no palette, nodes can't be dragged, fields use a sunken background, and Save and Run are hidden.
- **Runs:** a table with Run #, Status, Store and env, Started, Started by, Duration, and Items (stacked bar plus a mono summary "240 · 9 ✗ · 3 ?").
- **Run trace:**
  - Header: breadcrumb, "Run #128", status, and a **Timeline / On canvas** segmented toggle. A meta line shows flow and version, store and env, who started it and when, and the duration.
  - **Summary tiles** (clickable filters): Processed, Succeeded, Failed, and **Unknown as a solid orange tile**.
  - **Timeline:** a vertical rail of 26px status dots (check, x or ?) joined by a 2px line. Each step card shows a chip, name, note, duration, "N in → M out", per-status count chips and a proportional bar. The step containing unknowns gets an orange border. Clicking a step scopes the items panel to it.
  - **On canvas:** the flow graph with a status icon per node, count chips, coloured edges and edge count labels ("240", "61 true", "175 false · end").
  - **Items panel** (right, `minmax(340px, 38%)`):
    - Filter pills: All / Unknown / Failed / Succeeded, with counts.
    - Item rows: row #, mono order, step, badge.
    - Detail: order number and "Open in Shopify ↗". An **Unknown** item gets a "Needs a human check" alert warning that a re-run may duplicate the effect. A failed item gets a danger alert with the reason. Input / Output / Error tabs show JSON in a sunken mono `pre`.
  - Poll while the run is active, and offer Cancel run in the header while it runs.

### Database (`Database.dc.html`)
- **List:** columns Connection (db icon chip, name, env tag, PostgreSQL version), Database (mono name plus truncated host), Reachability (badge plus check time), Last backup (badge plus meta), and a chevron. "Add connection" opens a right Sheet with a name and a write-only URL with a lock and helper text. The connection is tested before saving.
- **Detail:**
  - Header: back link, name, PROD tag, Reachable badge. Actions: Edit and **Back up now**. While a backup runs the button is disabled and reads "Backing up… 42%".
  - Facts strip: Host, Database, User, Server version, Port · SSL, with a "Last checked … · responded in 41 ms" bar and a Check connection button.
  - An inline edit form (name, URL left blank to keep the current one).
  - Backups table: Started (+ by), Status (badge, a progress bar while Running, and the failure reason in red when Failed), Size, Duration, and Download + delete icon.
  - Danger zone at the bottom.
  - **Back up confirm dialog:** names the database and host with a PROD tag, notes the expected duration and load, and warns that the file contains production data.
  - Progress continues in the background, and a toast fires on completion. The new row is briefly highlighted green.

### Settings / Members / Access (`Settings.dc.html`)
These are three tabs under one header (underline tabs: General, Members, Access).
- **General:** two-column sections (240px label column): Your profile (avatar, name, verified email) and Organization (name, read-only for non-owners with a lock note).
- **Members:**
  - Invite card on `--sunken` with an email input (mail icon), Send invite, and the helper "Invitations grant the Member role and expire after 7 days." The org select was removed because the active org is in the sidebar.
  - Members list: avatar, name and "· you", email, role chip, joined date, activity dot.
  - Invitations list with status badges (Pending = info, Accepted = success, Expired/Revoked = neutral), the expiry text, Revoke, and Load more.
- **Access:**
  - **Master–detail roles:** a 250px list of role cards (icon chip, name, "N members · M permissions") with "Create custom role". The detail shows the role name, a Built-in tag, a description and the member count, then a **permission grid grouped by resource** (Organization, Members, Roles & audit, Shopify stores, GraphQL, Flows, Databases). Each group shows an "x/y" count and checkbox rows with the human label and the mono permission key. Built-in roles are read-only (dark grey checks). Custom roles are editable (accent checks) and have Save role.
  - Role assignments: rows with a role Select. It's locked for yourself and for non-owners.
  - Audit log: a segmented filter (All, Stores, Flows, Database, Members). Rows show a mono timestamp, an icon tile, "**Who** did what `object`", and a mono event key.

### Auth (`Auth.dc.html`)
- **Split layout:**
  - Left: a form column with a 380px max-width form, the brand at the top, a footer, and the form centred.
  - Right: a `--sidebar`-coloured panel with an eyebrow, a 30px headline, and a static mini run-trace card as product illustration.
- **Screens:**
  - Sign in: with an error alert state and a spinner on submit.
  - Sign up: with a 4-segment password strength meter.
  - Forgot password: then a "Check your email" confirmation.
  - Reset password.
  - Verify email: verified and expired variants.
  - Invitation: org chip, inviter, role explanation, "Signed in as … Switch", Accept / Decline, expiry.
- The dashed "Prototype:" switcher controls are prototype-only. Don't build them.

## Interactions and behaviour
- **Feedback:** use Sonner toasts for every mutation outcome: saved, connected, health check, copied, run started, backup complete. Long work (runs, backups) shows inline progress and a toast when it finishes.
- **Risk:** any write against a PROD target (GraphQL mutation, flow run, backup) shows the target's name, domain and env tag, uses a red primary button, and goes through a confirmation dialog.
- **Read-only:** never just hide things silently. Show a neutral `--sunken` banner with an eye icon that names the missing permission, and hide or disable the actions. Viewers get a full locked state on GraphQL.
- **Generic states per list screen:**
  - Loading: skeleton rows with shimmer (1.4s linear).
  - Empty: dashed-border card with a 44px icon tile, title, one sentence and one primary CTA.
  - Error: inline danger alert with Retry.
  - No organization: shell-level empty state.
- **Motion:**
  - Popovers and dialogs: fade plus translateY(8px), 140–160ms ease.
  - Drawers and toasts: slide in 24px from the right, 200ms.
  - Running dots pulse with an opacity of 1→0.3 over 1.4s.
  - Spinners use Lucide `loader-circle` rotating at 1s.
- **Keyboard:** ⌘K opens search, Esc closes overlays, ⌘S saves in the builder, ⌘↵ runs in the console.

## State management notes
- Active org, sidebar collapsed (persisted), and ⌘K open state.
- Flow builder: nodes and positions, selection, dirty flag, validation issues, version list, and run-dialog state (store, inputs).
- Run trace: selected step, item status filter, selected item, IO tab, and polling while status ∈ {Queued, Running}.
- Backup: poll status/progress while Queued/Running.
- Permission checks gate each action (see the roles in `original-brief.md`).

## Assets
- Icons: Lucide (`lucide-react`). Names used include `layout-grid, store, braces, workflow, database, settings, users, shield, search, panel-left, chevrons-up-down, key-round, shield-check, box, boxes, webhook, refresh-cw, loader-circle, circle-check, circle-x, circle-help, circle-dashed, triangle-alert, circle-alert, lock, eye, copy, external-link, play, history, list-checks, file-spreadsheet, package-search, split, tag, calendar-clock, git-fork, filter, pencil-line, hard-drive, hard-drive-download, download, trash-2, activity, bell-dot, send, mail, badge-check, crown, user, life-buoy, palette, log-in`.
- Fonts (Google Fonts): Albert Sans 400/500/600/700, Geist Mono 400/500/600, and Geist 400–700 (Console only).
- There are no images. Store, org and user marks are initials chips.

## Files
- `prototype/Wizdek.dc.html`: shell, theming (`theme()` holds both token sets), routing, ⌘K and toasts.
- `prototype/Dashboard.dc.html`, `Stores.dc.html`, `GraphQL.dc.html`, `Flows.dc.html`, `Database.dc.html`, `Settings.dc.html`, `Auth.dc.html`: the screens. Each file's logic class contains its mock data and state logic.
- `prototype/Tokens.dc.html`: the design-language sheet (principles, swatches, badges, categories, type, controls, CSS tokens).
- `prototype/support.js`: runtime for viewing the prototype only. Don't port it.
- `original-brief.md`: the product brief.
