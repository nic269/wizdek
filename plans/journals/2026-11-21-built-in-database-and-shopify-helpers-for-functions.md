---
title: Built-in database and Shopify helpers for functions
date: 2026-11-21
summary: Scripts import wizdek to query granted databases and run Shopify GraphQL on granted stores through a run-scoped token; credentials stay in wizdek-api.
---

# Built-in database and Shopify helpers for functions

## What happened

Implemented the built-in helpers for Wizdek Functions. A function now has a grant list of stores and database connections, each with an alias. When a run starts, the API creates a `wfr_` token, stores only its SHA-256 on the run and passes it to the container with the runtime URL and run context. A preinstalled `wizdek` module (one file per runtime) calls a separate Hono app on port 3003 with that token; the API resolves the grant, decrypts the connection or store token itself and runs the call. The token works only while the run is queued or running and is cleared when it ends.

## Problems found

- `pg`'s `query_timeout` silently breaks `pg.Query` objects: the driver replaces the query's callback, so the `error` event never fires and every failing statement hung until the test timed out. Replaced it with a call-wide deadline that ends the connection 5 s after the server-side statement timeout. Caught by a new database-tools integration test, not by the happy-path API tests.
- `queryMode: "extended"` works at runtime but is missing from `@types/pg`; typed through an extended `QueryConfig`. Verified directly that Postgres then refuses `select 1; select 2`.
- Sandbox containers use a custom DNS server, so `host.docker.internal` did not resolve on the Mac. Added `--add-host host.docker.internal:host-gateway`; on the runner VM that address is already dropped by the egress rules.
- The local database password equals its user name, so a "password never appears in responses" assertion failed on the username field. The test now checks that the connection URL never appears.

## Decisions

- Transactions are a list of statements sent in one call, not a callback, so no connection stays open between calls.
- Reads are judged by the first keyword (select, show, explain); `with` counts as a write. Writes are audited with SQL text but never parameters.
- Shopify queries from functions are counted on the run but not audited; mutations go through the existing audit path with function and run ids.
- Disconnecting a store, not only deleting it, removes its grants.

## Next steps

Phase 9: publish 10.10.10.30:3003 restricted to the runner, add the sandbox egress exception from phase 1, and verify the helpers on the real runner. Nothing committed yet.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
