---
phase: 1
title: "Phase 1: Runtime Tooling and Shared Crypto"
status: todo
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Runtime Tooling and Shared Crypto

## Context Links

- API image: `Dockerfile` (stage `api-runner`, base `node:24-alpine`)
- Image validation: `scripts/docker/validate-production-runtimes.mjs`
- CI: `.github/workflows/ci.yml` (job `validate`, `ubuntu-latest`, service `postgres:17-alpine`)
- Encryption helper: `packages/shopify/src/crypto/secret-encryption.ts` and its test
- Env contract for the key: `packages/shopify/src/keys.ts`
- Import rules: `boundaries.config.json`

## Overview

Make `pg_dump` and `pg_restore` available everywhere a backup or its tests run, and move the secret-encryption helper to a package that both Shopify code and the new database code may import.

## Key Insights

- Alpine 3.24 (the base of `node:24-alpine`) offers `postgresql18-client`. A newer `pg_dump` can dump an older server, so client 18 covers the EVISU database (16) and the toolkit's own (17).
- `pg_dump` refuses a server newer than itself. CI's database is 17, so the runner needs client 17 or newer regardless of what it ships with.
- On macOS, Homebrew's `libpq` is keg-only and does not land on `PATH`. A configurable directory avoids forcing a `brew link`.
- `@repo/shopify` may import only `@repo/database` and `@repo/logger`. `@repo/security` is empty and imports nothing, so it can hold the helper without creating a cycle.
- Eight files import the helper through `@repo/shopify/crypto` or a relative path. Keeping `@repo/shopify/crypto` as a re-export leaves them untouched.

## Requirements

- The `api-runner` image has `pg_dump` and `pg_restore` at major version 18.
- The image validation script fails if either tool is missing.
- CI installs PostgreSQL client 18 before tests run.
- An optional env var `POSTGRES_CLIENT_BIN_DIR` names the directory holding the tools; when unset, they are found on `PATH`.
- `encryptSecret` and `decryptSecret` live in `@repo/security`, behave identically, read the same `SHOPIFY_TOKEN_ENCRYPTION_KEY`, and existing ciphertexts still decrypt.

## Related Code Files

- Modify: `Dockerfile` (add `RUN apk add --no-cache postgresql18-client` to `api-runner`, before `USER app`)
- Modify: `scripts/docker/validate-production-runtimes.mjs` (run `pg_dump --version` and `pg_restore --version` in the API container)
- Modify: `.github/workflows/ci.yml` (install `postgresql-client-18` from the PGDG apt repository)
- Modify: `.env.example` (document `POSTGRES_CLIENT_BIN_DIR`)
- Create: `packages/security/src/secret-encryption.ts`, `packages/security/src/secret-encryption.test.ts`, `packages/security/src/keys.ts`
- Modify: `packages/security/src/index.ts`, `packages/security/package.json` (exports `./crypto` and `./keys`; add `@t3-oss/env-core` and `zod`)
- Modify: `packages/shopify/src/crypto/index.ts` (re-export from `@repo/security/crypto`)
- Delete: `packages/shopify/src/crypto/secret-encryption.ts`, `packages/shopify/src/crypto/secret-encryption.test.ts`
- Modify: `packages/shopify/package.json` (add `@repo/security`), `boundaries.config.json` (`@repo/shopify` may import `@repo/security`)

## Implementation Steps

1. Add the client package to the `api-runner` stage. Build the image and run `pg_dump --version` as the `app` user to confirm it is on `PATH` and executable without root.
2. Extend the validation script so the API runtime check runs both `--version` commands and fails on a non-zero exit.
3. Add a CI step, before the test steps, that adds the PGDG repository and installs `postgresql-client-18`, then prints `pg_dump --version`.
4. Move the helper and its test into `packages/security`. Give the package its own `keys.ts` that reads `SHOPIFY_TOKEN_ENCRYPTION_KEY` with the same validation as `packages/shopify/src/keys.ts`. Leave the Shopify env contract in place; it still documents the key for that package.
5. Turn `packages/shopify/src/crypto/index.ts` into a re-export, add the dependency and the boundary rule.
6. Add a test that decrypts a ciphertext produced by the old module location with a fixed key, proving the format did not change.
7. Document `POSTGRES_CLIENT_BIN_DIR` in `.env.example` with a macOS example path.

## Todo

- [x] Client 18 installed in `api-runner` and verified as the `app` user
- [x] Validation script checks both tools
- [x] CI installs client 18
- [x] Helper moved to `@repo/security`, Shopify re-exports it
- [x] Boundary rule and dependency added
- [x] Format-compatibility test added
- [x] `.env.example` updated

## Success Criteria

- `pnpm docker:validate` passes and reports both tool versions.
- `pnpm boundaries` and `pnpm check-types` pass.
- `pnpm --filter @repo/security test` and `pnpm --filter @repo/shopify test` pass, including the existing store and token tests that encrypt and decrypt.
- `pnpm --filter @repo/shopify test:integration` passes, proving stored tokens still decrypt.

## Risk Assessment

- **The apk package name changes with a base-image update.** The validation script catches it at build time rather than at the first backup.
- **Moving the helper breaks an import.** The re-export keeps every current import path valid; typecheck covers the rest.
- **PGDG install slows CI.** It is one apt install; acceptable against a twenty-minute budget.

## Security Considerations

- The key, algorithm and ciphertext format are unchanged. No stored secret is re-encrypted.
- The client package adds `psql` to the image as well. It is only reachable by code running as `app`, which already holds `DATABASE_URL`.

## Next Steps

Phase 3 uses `@repo/security/crypto`. Phase 4 uses the installed tools and `POSTGRES_CLIENT_BIN_DIR`.
