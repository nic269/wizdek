---
title: Plan database tools with PostgreSQL backup
date: 2026-10-14
summary: "Brainstormed and planned saved database connections and pg_dump backups; PostgreSQL first, other engines deferred."
---

# Plan database tools with PostgreSQL backup

## What happened

The user asked for a Database page that will hold several database tools, starting with a backup feature that works from nothing but a connection URL. The driving case is backing up the EVISU production database (PostgreSQL 16) before a deploy. A brainstorm settled the contract, then a 7-phase plan was written at `plans/261014-0309-database-tools-postgres-backup/plan.md` (about 7 days).

## Decisions

- Run the engine's own dump tool (`pg_dump -Fc`) as a child process inside a pg-boss job. Rejected `docker run` (no Docker socket in the deployed container) and dumping with a JS driver (restores are not trustworthy).
- PostgreSQL only for now. The user deferred MySQL/MariaDB and MongoDB until there is a real need; the adapter boundary stays so they can be added later.
- Connections are saved per organization with the URL encrypted. The AES-GCM helper moves from `@repo/shopify` to `@repo/security` and keeps `SHOPIFY_TOKEN_ENCRYPTION_KEY`, so there is still one key to back up.
- Archives go to the configured storage provider, are downloadable, and are kept until someone deletes them.
- A new `databases` permission module is granted to Owner and Admin only. `VIEWER_PERMISSIONS` picks up every `read` action, so the module has to be excluded explicitly.

## Evidence found while planning

- `node:24-alpine` is Alpine 3.24.2 and offers `postgresql18-client`. Client 18 can dump both the EVISU server (16) and the toolkit's own (17).
- The developer machine has Docker but no `pg_dump`.
- `StorageProvider.putObject` and `getObject` buffer the whole object, so stream methods are needed before large archives can be stored.
- URLs written for Prisma carry parameters such as `?schema=public` that libpq rejects. Only `sslmode` is kept.
- The `pg` driver treats `sslmode=require` as verify-the-certificate, which is stricter than libpq. The connection test must follow libpq's meaning, or it fails where `pg_dump` would succeed.

## Open risks

- Nobody has checked whether the Next.js `/api` rewrite streams multi-gigabyte downloads. Phase 5 tests this and names two fallbacks.
- The S3 stream upload has no automated test coverage, so it has to be verified by hand.
- The deployed API connects to any host a permitted user enters, and there is no outbound allowlist. This is accepted for now: only Owner and Admin can do it, and every connection and backup is audited.

## Next steps

Run `/ak:cook plans/261014-0309-database-tools-postgres-backup/plan.md`. Before the first real EVISU production backup, rehearse on a non-production copy and confirm the archive restores.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
