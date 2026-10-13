# Architecture

Shopify Toolkit is a developer toolkit for teams that work across many Shopify stores. A developer in an organization connects stores, runs Admin GraphQL against them in a console, and builds flows that run durably with a per-node, per-item trace.

## System shape

The repository is a pnpm and Turborepo monorepo generated from the Wizloft boilerplate (`saas` profile, apps `app` and `api`). `boilerplate.receipt.json` records the generation source.

| Part | Role | Local port |
|------|------|-----------|
| `apps/app` | Next.js App Router UI | 3000 |
| `apps/api` | Hono server exposing contract-first oRPC routes and Better Auth | 3002 |
| Postgres 17 | Application data, and later the job queue | `POSTGRES_PORT` in `.env` |

The browser reaches the API same-origin through the rewrites in `apps/app/next.config.ts` (`/api/:path*`), so session cookies and origin checks apply to every API call.

Tenancy is the boilerplate's Organization model. Every product record belongs to an organization, and permissions come from the catalog in `packages/access-control`.

## Packages

Existing packages under `packages/` come from the boilerplate: `api` (contracts and routers), `auth`, `access-control`, `database` (Prisma schema and migrations), `jobs`, `storage`, `design-system`, and supporting packages. Import rules between them are declared in `boundaries.config.json` and enforced by `pnpm boundaries`.

## Planned product code

These locations are reserved by the implementation plan and are added phase by phase. This section is updated as each one lands.

| Location | Purpose |
|----------|---------|
| `packages/shopify` (`@repo/shopify`) | Server-only Admin GraphQL client, secret encryption, OAuth helpers, credential strategies, store repository and token resolver |
| `packages/database` | Shopify store, app, token and OAuth state models; later flow and run models |
| `packages/api` | Contracts and routers for stores, the GraphQL proxy, flows and runs |
| `packages/jobs` | `pg-boss` provider behind `JobQueueProvider`; the worker runs inside `apps/api` |
| Flow engine package | Graph validation, typed node registry and the item-based executor |
| `apps/app` | Store connections UI, GraphiQL console with Explorer, flow builder canvas, run trace |

## Local development

Follow the setup in the [root README](../README.md). If another project already holds port 5432, set `POSTGRES_PORT` and the port in `DATABASE_URL` to a free port in `.env`; `docker-compose.yml` reads `POSTGRES_PORT`.

`pnpm release:check` runs lint, type checks, tests, boundary checks and the build in one command.
