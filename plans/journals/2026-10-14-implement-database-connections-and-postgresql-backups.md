---
title: Implement database connections and PostgreSQL backups
date: 2026-10-14
summary: "Built the Database page with encrypted connections and pg_dump backups; found an S3 checksum bug, a turbo env gap, and a PG16 restore message along the way."
---

# Implement database connections and PostgreSQL backups

## What happened

Implemented plan `plans/261014-0309-database-tools-postgres-backup` on branch `feat/database-backup`: a Database page where an organization saves an encrypted connection from a pasted URL, backs a PostgreSQL database up with `pg_dump -Fc` in a pg-boss job, and downloads the archive. New package `@repo/database-tools`; the encryption helper moved to `@repo/security`; storage gained stream methods; the API image installs PostgreSQL client 18.

## Things the checks caught

- **S3 multipart uploads were broken.** Testing against an S3-compatible server showed the SDK opens multipart uploads with a CRC32 checksum that `lib-storage` does not complete, so the server rejects the upload. Upgrading the SDK and setting the algorithm explicitly did not help. The fix is `requestChecksumCalculation: "WHEN_REQUIRED"` on the client.
- **Turbo hid the new env vars.** `envMode: strict` dropped `POSTGRES_CLIENT_BIN_DIR`, so tests passed when vitest ran directly but failed under `pnpm test:integration`. `pnpm dev` would have failed the same way on macOS. Both vars are now declared for build, test, test:integration and dev.
- **Restoring into PostgreSQL 16 with client 18** prints one `transaction_timeout` error and exits with status 1, but the data is complete. This is now documented, since it is exactly the EVISU case.
- **`pnpm docker:validate` already failed on `main`.** The script sets no durable job provider, and production has required one since the pg-boss commit. The image was checked directly instead: the tools run as `app`, and the API boots with `/health` returning 200.

## Evidence

The release check passes. 170 integration tests pass across 7 packages, including backup, restore, and a comparison of tables, row counts and sequences. Browser tests pass on desktop and mobile. A 1.3 GB backup downloaded through the app origin with flat memory. While `pg_dump` ran, the process list showed no credentials.

## Next steps

- Fix the validation script by giving it a Postgres container and `JOBS_PROVIDER=pgboss`.
- Commit and open a PR when asked.
- Rehearse the first EVISU production backup by restoring it into a non-production database.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
