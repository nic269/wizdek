# OMS management in Wizdek

OMS management is a native route of `apps/app`, sharing the Wizdek shell, login and design-system components. Open **http://localhost:4000/works/oms-management** through **Works → OMS management**. No separate server, iframe, reverse proxy or port 4010 is required.

## Routes

- `/works/oms-management`: overview and connection selection.
- `/works/oms-management/debug-logs`: workflow cards, module/status/search filters, timeline, payloads, Copy Bundle and Download Original. Filter query parameters and `run=<id>` support direct links.
- `/works/oms-management/settings/site-config`: maintenance, Shopify defaults/site timezone, custom app configuration and cronjobs.
- `/works/oms-management/settings/site-config/cronjobs`: schedules and runs.
- `/works/oms-management/settings/site-config/tools`: audited store secrets/downloads and fraud review.
- Append `?profile=staging` or `?profile=production` to keep environment selection in each tab.
- Old `/oms` bookmarks redirect to the native route; `/oms/e/<profile>` retains the selected profile.

## Module boundary

All OMS server logic, connections, SQL, policy, snapshots/audits, components and tests live under this route's `_module` folder. Route handlers live beside it under `api/`. Shared integration is limited to the generic Wizdek auth adapter, design-system components and declarative navigation. No OMS model is added to Wizdek's database or another feature package.

The native page uses `AppShellLayout`. The backend identity adapter validates the current Wizdek session directly with refresh disabled; normal same-origin `/api/identity` handles browser renewal. OMS account scopes and elevated capabilities still require the module's explicit policy. Having a Wizdek session alone does not grant OMS production writes.

## Configuration and data

Run Wizdek's usual app/API development commands. Place the module's environment settings from `.env.example` into Wizdek's root `.env` or the `apps/app` deployment environment. Existing app configuration is loaded by its normal dev/start command. `OMS_PUBLIC_URL` defaults to `NEXT_PUBLIC_APP_URL`; local default is `http://localhost:4000`. A separate `WIZDEK_IDENTITY_ORIGIN` is no longer needed by the native adapter.

The connection form follows Wizdek's Database page: **Name → Database URL → Environment → optional API URL + service token → Test & save**. It generates an internal connection ID, checks readable OMS features, and encrypts credentials. When an API is supplied, Wizdek automatically compares the API database fingerprint with the selected DB before saving; there are no database/deployment ID fields. Use your existing PostgreSQL login; the app does not require or create a special DB role. New connections cover the selected database without OMS account IDs. Tools that need an account load workspace account names and member names/emails from that database after connecting. They never read authentication tokens/passwords to populate the selector.

Debug details retain full redacted error/metadata payloads and paginate the timeline. Copy Bundle retrieves all pages, with an explicit error above 50,000 logs or 20 MB rather than a partial export. Original imports stored as DB text and legacy reconstructed CSVs download directly through the selected connection. S3/R2 originals use the DB-bound storage configuration in Wizdek. The server derives the download account from the workflow and validates any explicitly selected account. Site config, custom apps, store secrets, and cron schedules/start/stop use direct DB access without calling OMS API. Immediate cron execution and fraud-review business commands still run through the verified OMS API. Custom-app secrets are never returned in settings reads.

Configure the allowed Wizdek operator and capabilities for `staging`, `production` and `custom`, with database-wide scope enabled for this single-operator workflow. DB host/API origin allowlists are optional: empty lists permit operator-supplied destinations, while non-empty lists restrict them. The network guard still rejects metadata/link-local endpoints and pins resolved addresses. Local loopback requires `OMS_ALLOW_LOCAL_CONNECTIONS=true`. Staging/production presets remain optional. All target connections remain server-side. Writes default off and retain backup, confirmation, CAS and audit checks. Direct DB operations do not require an API; execution commands additionally verify the DB/API fingerprint automatically. The OMS bridge needs only `OMS_MANAGEMENT_SERVICE_TOKEN` beyond its existing database configuration. Use a distinct token for staging and production. Existing saved connections remain readable; no profile backfill is required.

`OMS_DIRECT_RESOURCES_JSON` maps a database fingerprint (SHA-256 of canonical host/port/database coordinates) to that OMS database's `encryptionKey` and optional `storage` configuration. The encryption key must be the same value OMS uses for token encryption; it is separate from `OMS_PROFILE_ENCRYPTION_KEY`. Storage configuration supplies region, bucket, required environment prefix, optional HTTPS S3-compatible endpoint, and optional credentials. Omitted credentials use the AWS SDK provider chain. Grant read access only to the selected bucket/prefix. Never put these values in `NEXT_PUBLIC_*` or send them to the browser. DB-text/CSV downloads need no storage credentials; non-secret settings need no OMS encryption key.

URL handling supports PostgreSQL URLs and ignores ORM-only parameters such as `schema`. TLS defaults to encrypted `require`; `sslmode=verify-full` verifies the certificate/hostname, and `sslmode=disable` explicitly opts out of TLS. `allow`/`prefer` use encrypted connections without fallback, and `verify-ca` uses the stricter hostname verification as well. Existing saved profiles retain their prior TLS verification behavior.

`OMS_CONTROL_DB_PATH` is the management SQLite path; its default is `.data/oms-management/control.sqlite` relative to `apps/app`. Use a persistent writable path and a separate 32-byte encryption key. If the former standalone app has real profiles/history, stop it, take a consistent SQLite backup and preserve its key, then explicitly point the native module to that existing store or restore the backup. This source migration did not move, decrypt, discard or edit old local runtime data/environment files.

When this feature is enabled, the control store still permits one owning Node process. Deploy Wizdek with one owner for that volume; overlapping replicas will refuse management access. Other Wizdek routes do not depend on target DB availability. Multi-replica management requires a separate storage design before enabling it.

## Verification

From the Wizdek repository root:

```sh
pnpm --filter @repo/app check:oms-isolation
pnpm --filter @repo/app check-types
pnpm --filter @repo/app test:oms
pnpm --filter @repo/app test:oms:e2e
OMS_TEST_POSTGRES_URL=postgresql://postgres:oms_test_password@127.0.0.1:55439/postgres pnpm --filter @repo/app test:oms:integration
pnpm --filter @repo/app build
```

Browser tests use an isolated test-only harness and mocked identity/target HTTP responses; they do not bypass the production route auth gate or prove live operator access. Integration fixtures must use an empty disposable PostgreSQL instance. They create roles/databases; never point them at staging or production. Build does not need OMS credentials.

## Removal

Freeze writes, back up the control store/key, reconcile pending operations, then revoke bridge/diagnostic credentials. Remove `app/works/oms-management`, the old `/oms` alias, the OMS navigation entry and OMS scripts/workflow. Remove the Works landing page only if it has no remaining tools. Generic shell nesting, design-system primitives and auth can stay; they contain no OMS business logic. The module's removal script rehearses this in a temporary snapshot.

The small OMS bridge remains additive. Legacy `G_ADMINISTRATOR` and privileged tools are unchanged until deployed parity, recovery and UAT pass. See [operations](docs/operations.md), [cutover gates](docs/cutover.md), and the plan's native-route migration report.
