# Wizdek UI/UX redesign

Status: implemented 2026-10-15, awaiting the user's review (approved 2026-10-14; the user asked for all phases without pausing) · branch `feat/wizdek-redesign`
Source: `docs/design/design_handoff_wizdek_redesign/` (README, original-brief, prototype)

## Outcome

The app is rebuilt to the Paper direction of the handoff, using shadcn on Base UI, Tailwind v4, Lucide, Sonner, Sheet, AlertDialog and Command. GraphiQL and React Flow are restyled, not replaced. Every list screen has empty, loading, error and read-only states driven by real permission checks.

## Constraints

- Values (colour, size, radius, copy) match the README. The prototype decides anything ambiguous.
- No native select or checkbox elements.
- No features beyond the brief. Data the backend lacks is a decision for the user (see Open decisions).
- Light only. The Console direction ships as an unused `.theme-console` class.

## Non-goals

Dark mode, new product features, replacing GraphiQL or React Flow, and the prototype's switcher controls.

## Phases (one commit each)

| # | Phase | README section | Main files |
|---|-------|----------------|-----------|
| a | Tokens and fonts | Visual direction, Design tokens, Status palette, Env tags, Node categories, Store identity, Type scale, Spacing | `apps/app/app/product-shell.css` → `wizdek-tokens.css`; `packages/design-system/src/styles/fonts/` (self-host Geist Mono); `theme-contract.css` (`@theme` mappings for new tokens) |
| b | Shared components | Status palette, Env tags, Interactions → generic states | `packages/design-system/src/components/`: `status-badge.tsx`, `env-tag.tsx`, `page-header.tsx`, `empty-state.tsx`, `state.tsx` (ErrorAlert, skeletons), `read-only-banner.tsx`, `secret-input.tsx`, `identity-chip.tsx` |
| c | App shell | App shell | `packages/design-system/src/components/app-shell.tsx`, `apps/app/app/app-shell-layout.tsx`, `normal-app-shell.tsx`, `account-menu.tsx`, `lib/active-organization.tsx`, `packages/config` (nav groups, brand) |
| d | Dashboard | Dashboard | `apps/app/app/dashboard/*` |
| e | Flows | Flows | `flows/flows-panel.tsx`, `flows/[flowId]/*` (builder, node, palette, config panel, validation, run dialog, activation, `flow-builder.css`), `runs/runs-panel.tsx`, `runs/[runId]/*` |
| f | Stores | Stores | `stores/stores-panel.tsx` + new `store-drawer.tsx`, `stores/new/connect-store-form.tsx`, `stores/apps/shopify-apps-panel.tsx` |
| g | GraphQL | GraphQL console | `graphql/console-toolbar.tsx`, `graphql-console.tsx`, `graphql-console.css`, `response-status-bar.tsx`, `saved-queries-plugin.tsx`, `use-console-fetcher.ts` |
| h | Database | Database | `database/connections-panel.tsx`, `database/new/*` (becomes a Sheet), `database/[connectionId]/*`, `backups-table.tsx` |
| i | Settings | Settings / Members / Access | `settings/layout.tsx` (tabs), `settings/page.tsx`, `members/members-panel.tsx`, `access/access-panel.tsx` |
| j | Auth | Auth | `(auth)/layout.tsx` (split layout), `auth-form.tsx`, forgot, reset, verify, `invite/[token]/*` |

Each phase is verified by checking types, running Biome and unit tests, and running the affected e2e specs on an isolated stack. Screenshots are compared against the prototype.

## Decisions (approved 2026-10-14)

- Brand becomes "Wizloft devkit" (short name "wizdek"); the "wizdek · v2.4" line stays as is for now.
- Add an `environment` enum (PROD, STAGING, DEV; default DEV) to ShopifyStore and DatabaseConnection, chosen when connecting and editable later.
- Add a per-flow run `number` for "Run #128".
- Record who started a backup; store the connection's port and SSL mode for display.
- Add read endpoints: the caller's permissions in an organization, a flow's version list, recent runs across the organization with per-status item counts, richer `flows.list` rows (trigger, step count, version, last run store), and store and member counts per organization.
- Backup progress is an indeterminate bar with elapsed time (pg_dump reports no percentage).
- Drop "responded in N ms" and the member activity dot (no data).
- The store danger zone counts runs and activations only (saved queries do not reference a store).
- Editing a custom role, renaming an organization and declining an invitation stay unavailable: shown read-only or omitted.
- The Run dialog counts CSV rows in the browser for "up to N items".
- shadcn `--accent` is the indigo accent, so menu highlights use `--hover` instead.

## Added during implementation

- The audit log endpoint accepts several comma-separated prefixes in `actionPrefix`, so the Members filter covers members, invitations and roles.
- `invitations.preview` (`POST /api/invitations/preview`) lets the invitation page show the organization, inviter, role and expiry before signing in.
- The profile name is saved with Better Auth's `updateUser`; the organization name stays read-only.
- Email verification from the page omits the callback URL, so a bad or expired token is reported instead of shown as verified.
- The database page lists backups of deleted connections again (dropped by mistake in phase h).
- Flow changes, runs started and canceled by people, and activations are recorded in the audit log (requested after review).
- The design prototypes are excluded from Biome; the migration was applied to the dev database on 2026-10-15 (no backup, at the user's request).

## Known gaps

- The add-tags "Resource" segmented control from the prototype is not built: the node has no field for it.

## Commits

`20c6122` tokens · `a09a697` shared components · `23bddcb` shell · `ce62ab6` dashboard · `1b3c38f` flows · `4bdda75` stores · `366ad0b` GraphQL · `46a2fb9` database · `d5a4b11` settings · `7fe3fc3` auth · `5bf08a0` deleted-connection backups
