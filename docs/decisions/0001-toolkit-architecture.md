# Decision 0001: Toolkit architecture

- Status: accepted
- Date: 2026-10-13

## Context

Shopify Toolkit gives developers one place to connect many Shopify stores, explore and run Admin GraphQL against them, and automate work with visual flows. It is built on the Wizloft boilerplate and borrows Shopify client patterns from an earlier order-management project, without any of that project's business logic.

## Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| Audience | Internal first, public later. Keep Organization tenancy; no marketing app or billing. | Tenancy is cheap to keep now and expensive to retrofit; marketing and billing have no internal user. |
| Scaffold | Boilerplate `saas` profile with apps `app` and `api`. | The `core` profile removes Organization, jobs, storage and access control, all of which the product needs. |
| Console | Embed `graphiql` 5 with `@graphiql/plugin-explorer`; the fetcher calls an API proxy. | GraphiQL already provides the editor, docs, autocomplete and Explorer tree. The proxy keeps store tokens on the server and is where permissions and audit apply. |
| Flow engine | Own engine on `@xyflow/react`: graph JSON in Postgres, a typed node registry, an item-based data model. | The reference project's engine is a linear import pipeline; only its registry pattern carries over. Owning the engine keeps per-item tracing and crash semantics under our control. |
| Durable runs | `pg-boss` on the existing Postgres behind `JobQueueProvider`; the worker runs inside `apps/api`. | No extra infrastructure for an internal tool. Moving the worker to its own process later is a configuration change. |
| Store access | Three credential strategies: pasted static token, OAuth install through an app registry, client credentials through the same registry. | These are the ways a developer actually holds access to a store: a custom-app token, an installable app, or an app owned by the same organization as the store. |
| Store data model | Dedicated Shopify tables rather than the boilerplate's `IntegrationConnection`. | `IntegrationConnection.config` is untyped JSON with no encryption, expiry or relations, which tokens need. |
| Crash semantics | At-least-once per item. Idempotent actions re-execute; non-idempotent actions interrupted mid-call are marked `UNKNOWN` and never re-executed. | A repeated idempotent call is harmless, while silently repeating a non-idempotent mutation on a live store is not. |
| Run concurrency | One flow run at a time per store; runs for different stores proceed in parallel. | Shopify rate limits are per store, so serialising per store keeps throttling predictable. |
| Audit | Every console execution records metadata, the document and the variables. | Full traceability was chosen over minimising stored customer data. Audit rows can therefore contain customer data and must be access-controlled accordingly. |
| Member role | Members view stores, run queries and mutations, and view and run flows. Managing connections and authoring flows need Admin, Owner or a custom role. | Day-to-day use should not need an administrator, while credentials and automation definitions stay with trusted roles. |

## Out of scope

OMS features, a Shopify embedded or App Store app, the Storefront API and REST, an AI assistant, an arbitrary-code node, a node marketplace, billing, a marketing site, deployment automation, and any use of the Shopify CLI's client to obtain collaborator access.

## Consequences

- Postgres carries application data, the job queue and run traces, so its availability and backups cover the whole product.
- The secret encryption key protects every stored store credential. Losing or changing it makes them unreadable, so it must be backed up with the database.
- Running the worker inside the API process ties job throughput to API deploys until the worker is split out.
