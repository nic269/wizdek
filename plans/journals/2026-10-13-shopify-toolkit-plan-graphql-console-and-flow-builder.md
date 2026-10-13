---
title: "Shopify Toolkit plan: GraphQL console and flow builder"
date: 2026-10-13
summary: "Brainstormed and planned a nine-phase build on the wizloft-boilerplate; plan validated with the owner, nothing implemented yet."
---

# Shopify Toolkit plan: GraphQL console and flow builder

## What happened

Scoped a developer toolkit for Shopify from an empty repository: multi-store connections, a GraphiQL console with Explorer, and an n8n-style flow builder. Inspected the boilerplate (generation source) and the EVISU OMS project (pattern reference), checked current npm and Shopify facts, then wrote a nine-phase plan at `plans/261013-1555-shopify-toolkit-graphql-console-and-flow-builder/`.

Findings that shaped the plan:

- The boilerplate generator refuses an existing target directory and derives the package slug from the target's basename, so generation goes through a temporary sibling directory named `shopify-toolkit`.
- The boilerplate's job provider is in-memory only, and the reference project's import runner is documented as not restart-safe. Neither source offers durable execution.
- The reference workflow engine is a linear, import-row pipeline; only its registry and path-resolution patterns carry over.
- Shopify has no API that grants access to every store a Partner account can open. The supported equivalent is an app registry with client credentials (same organization) and OAuth install (other stores).
- New app routes would sit outside the auth guard, whose matcher covers only `/dashboard` and `/settings`.

## Decision

- Embed GraphiQL 5 with the Explorer plugin behind an API proxy; build the flow engine in-house on xyflow with an item-based model; run flows on pg-boss in the existing Postgres.
- Three credential strategies: pasted static token, OAuth install, client credentials.
- Owner's validation answers: audit stores the GraphQL document and variables; the Member role may run mutations and flows; flow runs are serialised per store; the bulk mutation node stays in scope.

## Next steps

- Execute phase 1 (generate the project, initialise git, prove the baseline).
- Early spikes carry the main risks: Monaco workers under Next 16, the Explorer plugin under React 19, and pg-boss re-delivery after a crash.
- Manual acceptance needs a Shopify dev store, a Dev Dashboard app, and a reachable URL for OAuth and webhooks.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
