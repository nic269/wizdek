# Shopify Toolkit documentation

| Document | What it covers |
|----------|----------------|
| [Architecture](./architecture.md) | System shape, apps and packages, where the Shopify and flow code lives |
| [Connecting Shopify stores](./stores.md) | Choosing a connection method, registering an app, store status |
| [GraphQL console](./graphql-console.md) | Using the console, permissions, what is audited, limits |
| [Flows](./flows.md) | Building and running flows, templates, step reference, run statuses, limits |
| [Decision 0001: Toolkit architecture](./decisions/0001-toolkit-architecture.md) | The accepted product and technical decisions, with rationale |
| [Decision 0002: Store enumeration](./decisions/0002-organization-store-enumeration.md) | Why stores are entered by domain rather than imported from a Shopify organization |
| [Decision 0003: GraphiQL bundling](./decisions/0003-graphiql-bundling.md) | Why the console uses the default Next.js toolchain, and what was tested |
| [Decision 0004: Durable jobs](./decisions/0004-durable-jobs-on-pg-boss.md) | Why jobs run on pg-boss, what was tested, and behaviour to know about |

Setup and the release check live in the [root README](../README.md). Implementation plans live in `plans/` and are working records, not product documentation.
