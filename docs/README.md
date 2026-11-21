# Shopify Toolkit documentation

| Document | What it covers |
|----------|----------------|
| [Architecture](./architecture.md) | System shape, apps and packages, where the Shopify, flow and function code lives |
| [Connecting Shopify stores](./stores.md) | Choosing a connection method, registering an app, store status |
| [GraphQL console](./graphql-console.md) | Using the console, permissions, what is audited, limits |
| [Flows](./flows.md) | Building and running flows, templates, step reference, run statuses, limits |
| [Database tools](./database.md) | Saving database connections, backing up PostgreSQL, restoring by hand, client setup |
| [Functions](./functions.md) | Writing and running functions, packages, the HTTP trigger, schedules, variables, the `wizdek` helpers, limits |
| [Decision 0001: Toolkit architecture](./decisions/0001-toolkit-architecture.md) | The accepted product and technical decisions, with rationale |
| [Decision 0002: Store enumeration](./decisions/0002-organization-store-enumeration.md) | Why stores are entered by domain rather than imported from a Shopify organization |
| [Decision 0003: GraphiQL bundling](./decisions/0003-graphiql-bundling.md) | Why the console uses the default Next.js toolchain, and what was tested |
| [Decision 0004: Durable jobs](./decisions/0004-durable-jobs-on-pg-boss.md) | Why jobs run on pg-boss, what was tested, and behaviour to know about |
| [Decision 0005: Database backups](./decisions/0005-database-backups-with-native-dump-tools.md) | Why backups run the engine's own dump tool, what was tested, and the network exposure |
| [Decision 0006: Functions runner](./decisions/0006-functions-on-a-dedicated-runner-vm.md) | Why functions run in containers on a separate VM, how credentials stay out of them, and what was verified |

Setup and the release check live in the [root README](../README.md). Implementation plans live in `plans/` and are working records, not product documentation.
