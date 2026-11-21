# Shopify Toolkit

A developer toolkit for teams that work across many Shopify stores: connect stores per organization, explore and run Admin GraphQL in a console with an Explorer tree, build flows on a canvas that run durably with a per-node, per-item trace, and run Node.js or Python functions in one-shot containers.

See [docs](./docs/README.md) for the architecture and the accepted decisions.

## Apps

- `apps/app`: Next.js UI on port 3000
- `apps/api`: Hono and oRPC API on port 3002, and the functions' helper routes on port 3004
- `apps/runner`: the functions runner agent on port 3003

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

## Functions

Functions need Docker and the runner agent. Generate one token and set it in `.env` as both `RUNNER_TOKEN` (the agent's) and `FUNCTIONS_RUNNER_TOKEN` (the API's), with `FUNCTIONS_RUNNER_URL=http://127.0.0.1:3003`:

```bash
openssl rand -hex 32
```

`corepack pnpm dev` then starts the agent with the other apps; it builds the runtime images on first start. Without `FUNCTIONS_RUNNER_URL` the Functions page says functions are not enabled. For the `wizdek` helpers, also set `FUNCTIONS_RUNTIME_URL=http://host.docker.internal:3004`, the address at which a run's container reaches the API on this machine. See [Functions](./docs/functions.md).

Run `corepack pnpm release:check` before release.

## Origin

Generated from the Wizloft `saas` profile. `boilerplate.receipt.json` records the selected profile, the initial generated-source digest, and best-effort source identity. It is passive origin metadata; builds and runtime behavior do not depend on it.
