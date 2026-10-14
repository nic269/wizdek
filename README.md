# Shopify Toolkit

A developer toolkit for teams that work across many Shopify stores: connect stores per organization, explore and run Admin GraphQL in a console with an Explorer tree, and build flows on a canvas that run durably with a per-node, per-item trace.

See [docs](./docs/README.md) for the architecture and the accepted decisions.

## Apps

- `apps/app`: Next.js UI on port 3000
- `apps/api`: Hono and oRPC API on port 3002

## Setup

```bash
corepack pnpm install
cp .env.example .env
docker compose up -d postgres
corepack pnpm db:generate
corepack pnpm db:migrate:deploy
corepack pnpm db:seed
corepack pnpm dev
```

Set random values of at least 32 characters for `BETTER_AUTH_SECRET` and `SHOPIFY_TOKEN_ENCRYPTION_KEY` in `.env`. If port 5432 is already in use, set `POSTGRES_PORT` and the port in `DATABASE_URL` to a free port before starting Postgres.

Database backups and their tests need the PostgreSQL client tools (`pg_dump`, `pg_restore`) version 17 or newer. On macOS run `brew install libpq` and set `POSTGRES_CLIENT_BIN_DIR=/opt/homebrew/opt/libpq/bin` in `.env`. See [Database tools](./docs/database.md#setting-up-the-client-tools).

Run `corepack pnpm release:check` before release.

## Origin

Generated from the Wizloft `saas` profile. `boilerplate.receipt.json` records the selected profile, the initial generated-source digest, and best-effort source identity. It is passive origin metadata; builds and runtime behavior do not depend on it.
