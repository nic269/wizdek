> Superseded architecture (2026-11-14): user requested a native `apps/app` route at `/works/oms-management`, under Works → OMS management, using the shared Wizdek shell and design system. See [native-route migration](./native-route-migration.md). Earlier standalone-app/deploy evidence below is historical.

# Implementation evidence — 2026-11-14

## Result

Implemented the independent `apps/oms-management` application, generic Wizdek identity integration, and additive OMS service bridge. Local implementation, build, isolation, targeted regression and disposable-DB checks pass. This is not a deployed or fully cut-over environment.

User-owned pre-existing Wizdek changes in option-select, shell navigation, config navigation and `apps/app/app/shopify/` were preserved. No commit, push, live database migration, live settings change or deployment was performed. Legacy `G_ADMINISTRATOR`, assignments, bypasses, routes and UI remain intact until the user's migration/verification condition is satisfied.

## Implemented scope

- Same-origin Wizdek login: generic `/api/identity`, active/verified user checks, no-store, renewal cookies; app-local subject/profile/capability policy. No OMS auth table or user synchronization.
- Staging/production presets and custom connection editor: masked credentials, immutable revisions, encrypted local SQLite storage, account/global scope ceilings, exact outbound allowlists, pinned DNS and independently configured DB/API binding.
- Per-tab switching and isolated caches/forms; bounded DB pools and read leases; old revisions retained for uncertain-operation recovery.
- Workflow filters/list/detail, bounded redacted diagnostics and summary, stable cursors, schema/grant probes, cron stored state plus verified API definitions.
- Maintenance preview/confirmation, atomic expected-version writes and audit, encrypted checksummed snapshots, UUID-bound operator backup evidence, prior-value and absent-row restore.
- Cron schedule/start/stop/run; Shopify apps/default configuration, signature changes and audited secret reveal; original import/CSV and DHL downloads; minimal fraud review through existing OMS business services.
- Durable operation receipts, definitive rejection vs unknown-result distinction, cross-operator recovery preserving original actor, serialized cancellation tombstones preventing delayed execution after recovery.
- Independent Docker/Compose/Caddy/CI assets, backup/removal scripts and deployment/cutover runbooks.

## Verified locally

| Check | Result / practical limit |
|---|---|
| Management unit suite | 29/29 pass: encryption/storage, policy/network, redaction, backup identity/checksum, recovery/outcomes |
| Real PostgreSQL integration | 13/13 pass on disposable PostgreSQL: two DBs with same IDs, scopes/pools/revisions, 100k-log bounded queries, maintenance CAS/audit/restore including absent row and stale-write rejection |
| Final absent-restore regression | Focused case passes after final guard: repeating restore when the row is already absent returns 409 with no new intent or audit |
| Browser switching suite | 6/6 Chromium pass with mocked HTTP; delayed reads, environment banner, logout clearing, connection secrets and unsaved-change switch |
| OMS bridge suite | 16/16 pass: scoped service auth, identity binding, atomic receipts/replay/rollback/tombstones, routing and reveal audit |
| Existing affected OMS regression | 69/69 scheduler + fulfillment service/routes pass |
| Generic Wizdek auth/API regression | Auth 62/62 and API 69/69 pass |
| Type checks | Management, generic auth/API and OMS API pass |
| Static checks | App Biome (58 files), boundary engine + standalone dependency assertion, both working-tree diff checks pass |
| Production builds | Management standalone Docker build and OMS API build pass |
| Container smoke | Read-only container filesystem; health 200, readiness 200, unauthenticated profiles 401, deep link 200 with `/oms/_next/` assets; own container stopped/removed |
| Removal rehearsal | Disposable source snapshot excluding management/wiring and OMS env: boundaries, auth/API checks/tests and surviving Wizdek app production build (22 routes) pass; snapshot removed |

Independent security review drove fixes for backup DB identity, production scope ceiling, failed reveal audits and uncertain command outcomes. Both server and UI simplifiers made scoped edits. Local mocks do not prove real auth-cookie renewal across 24 hours, public proxy behavior, provider delivery or live parity.

## Implementation decisions against the proposal

1. Explicit parameterized `pg` queries and runtime schema/privilege probes replace the proposed duplicate generated Prisma client. All contracts/queries stay app-local; management cannot run target migrations. This removes a shared-generation/build dependency.
2. Direct maintenance SQL uses conditional UPDATE/DELETE and conflict-safe INSERT in addition to the management lock, because the retained legacy writer does not acquire that lock. Versions advance at least one millisecond.
3. Bridge downloads reuse existing streaming handlers, then management buffers at most 50 MB before returning a download. Larger artifacts are rejected; true end-to-end streaming is not claimed.
4. Missing command receipt is reconciled under the execution lock into a durable cancellation tombstone. This safely terminates a never-executed request and blocks a delayed original request; unreachable/mismatched targets remain unknown.
5. Full-backup proof is an operator declaration bound to endpoint + DB UUID + expiry, not an automatic backup-provider integration. Before-snapshots are encrypted and checksum-verified. Automatic restore is for maintenance only; provider effects need domain recovery.

## Outstanding gates — do not mark complete

- Actual public origin/gateway ownership, persistent-volume host, registry/image rollout and TLS/network reachability.
- Secret-manager values, independent target markers/credentials, dedicated DB grants, live schema compatibility, initial operator user IDs/account scopes and current backup/restore evidence.
- Apply the additive receipt migration and provision target identities only through the backed-up deployment procedure. These are separate from shared-login auth, which needs no OMS auth DB change.
- Staging end-to-end login/renewal/revocation, write/command/provider parity, restart/response-loss recovery and backup restore UAT. Then production read-only rollout followed by controlled write verification.
- Per-user normal-role mapping and role-assignment backup/preview/migration/session-revocation artifacts. Final legacy reference disposition, gated retirement code and cutover rehearsal remain pending; no permissive role substitution is inferred.
- Full feature-matrix parity and ordinary OMS workflow regression at deployment before retiring any old role/tool. Runtime shutdown-independence and control-store restore rehearsal on the actual host remain pending.

## Runbooks

- [App overview/configuration](../../apps/oms-management/README.md)
- [Deployment/backup/recovery/removal](../../apps/oms-management/docs/operations.md)
- [Legacy cutover conditions](../../apps/oms-management/docs/cutover.md)
- OMS repository: `docs/oms-management-bridge.md`, additive migration `20261114020000_management_command_receipts`, and `apps/api/src/scripts/provision-management-identity.ts`.

Plan status stays **in-progress**. Completed local tasks are checked in phase files; unchecked tasks retain live verification or unfinished retirement preparation requirements.
