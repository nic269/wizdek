---
phase: 1
title: "Phase 1: Project Foundation"
status: todo
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Project Foundation

## Context Links

- Generator: `/Volumes/anh.nguyen/Projects/AnhN/wizloft-boilerplate/scripts/boilerplate-init/generator.ts`
- Generation policy: `/Volumes/anh.nguyen/Projects/AnhN/wizloft-boilerplate/boilerplate.init.json`
- First-run steps: `/Volumes/anh.nguyen/Projects/AnhN/wizloft-boilerplate/README.md`

## Overview

Generate the project from the boilerplate into this repository, initialise git, and prove the untouched baseline is green before any product code is added.

## Key Insights

- The generator calls `mkdir(target, { recursive: false })` (`generator.ts:483`), so it fails on this existing directory. Generate elsewhere and move the result in.
- The package slug comes from `basename(target)` (`generator.ts:474`). The temporary target's last path segment must therefore be `shopify-toolkit`.
- `--skip-install` deletes the copied `pnpm-lock.yaml`. Generate with install so the tested lockfile survives, then drop `node_modules` before moving.
- The manifest's `remove` list strips `.claude`, `docs`, `plans` and `AGENTS.md` from the output, so nothing collides with the `.claude`, `.agentkit` and `plans` directories already here.
- The `core` profile removes Organization, jobs, storage and access-control. Use `saas`.
- `docker-compose.yml` publishes Postgres on `${POSTGRES_PORT:-5432}`; sibling projects on this machine may already hold 5432.

## Requirements

- Generated output uses profile `saas` and apps `app,api` only.
- Existing `.claude/`, `.agentkit/` and `plans/` are byte-for-byte unchanged after the move.
- The repository is a git repository on branch `main` with one initial commit.
- The boilerplate validation ladder passes with no product changes.

## Architecture

No design change. The result is the boilerplate layout: `apps/app` (Next.js 16, port 3000), `apps/api` (Hono + oRPC, port 3002), and `packages/*`. The browser reaches the API same-origin through the Next rewrites in `apps/app/next.config.ts` (`/api/:path*`).

## Related Code Files

- Create: every generated file under the repository root.
- Create: `docs/README.md`, `docs/architecture.md`, `docs/decisions/0001-toolkit-architecture.md`.
- Modify: `README.md` (product description), `.env` (local only, never committed).

## Implementation Steps

1. Confirm prerequisites: `node -v` reports 24 or later, `corepack enable` has been run, Docker is running.
2. Record the current state for a later comparison: `ls -A` of the repository root and a checksum listing of `.claude`, `.agentkit`, `plans`.
3. Read the generator help from the boilerplate root (`corepack pnpm boilerplate:init --help`) and confirm the flags below still exist.
4. Create `/Volumes/anh.nguyen/Projects/wizloft/.gen/`, then from the boilerplate root run `corepack pnpm boilerplate:init /Volumes/anh.nguyen/Projects/wizloft/.gen/shopify-toolkit --name "Shopify Toolkit" --profile saas --apps app,api`.
5. In the temporary output, confirm it contains none of `.claude`, `.agentkit`, `plans`. Stop if it does.
6. Delete every `node_modules` directory inside the temporary output.
7. Copy the temporary output, dotfiles included, into this repository root, then delete `/Volumes/anh.nguyen/Projects/wizloft/.gen/`.
8. Run `corepack pnpm install --frozen-lockfile` in the repository root.
9. Compare against step 2: `.claude`, `.agentkit` and `plans` are unchanged.
10. Run `git init -b main`. Review the generated `.gitignore`; make sure `.env` and `.data/` are ignored and that `.claude/`, `.agentkit/config.yaml` and `plans/` are tracked.
11. Copy `.env.example` to `.env` and set a fresh random `BETTER_AUTH_SECRET` of at least 32 characters.
12. Check who owns port 5432 with `lsof -i :5432`. If another project holds it, set `POSTGRES_PORT=5440` in `.env` and point `DATABASE_URL` at that port. Do not stop a container this session did not start.
13. Run `docker compose up -d postgres`, then `pnpm db:generate`, `pnpm db:migrate:deploy`, `pnpm db:seed`.
14. Run the ladder: `pnpm check:ci && pnpm check-types && pnpm test && pnpm boundaries && pnpm build`.
15. Start `pnpm dev` as a tracked background process, sign up, create an organization, then stop the dev servers.
16. Write `docs/README.md` (index), `docs/architecture.md` (system shape and where the Shopify and flow packages will live) and `docs/decisions/0001-toolkit-architecture.md` (the Accepted Decisions table from `plan.md` with rationale). Replace the generated product description in `README.md`.
17. Commit as `chore: scaffold project from wizloft-boilerplate`.

## Todo

- [x] Generate into the temporary directory with profile `saas`, apps `app,api`
- [x] Move output into the repository; preserved directories verified unchanged
- [x] `pnpm install --frozen-lockfile` succeeds
- [x] Git repository initialised on `main`
- [x] Local Postgres running on a non-conflicting port; migrations and seed applied
- [x] Validation ladder green
- [x] Sign-up and organization creation verified in the browser
- [x] Docs skeleton and decision record written
- [x] Initial commit created

## Success Criteria

- `pnpm check:ci`, `pnpm check-types`, `pnpm test`, `pnpm boundaries` and `pnpm build` each exit 0.
- `boilerplate.receipt.json` exists and records profile `saas` and apps `app`, `api`.
- `git status` is clean after the initial commit and `git ls-files` contains no `.env`.
- A new user can sign up and create an organization at `http://localhost:3000`.

## Risk Assessment

- **Generator flags changed since this plan was written.** Signal: step 3 help output differs. Response: adapt the command; the profile and app set stay the same.
- **Port conflicts with sibling projects.** Signal: `address already in use` from Docker or Next. Response: identify the owner with `lsof`, use a project-specific port, never increment blindly.
- **Lockfile drift.** Signal: `--frozen-lockfile` fails. Response: regenerate with install; do not fall back to an unfrozen install without recording the diff.

## Security Considerations

- `.env` stays untracked; only `.env.example` with placeholder values is committed.
- Generate a new `BETTER_AUTH_SECRET`; never reuse the value from another project's `.env`.

## Next Steps

Phase 2 adds the Shopify package and data model. Phase 5 can start in parallel once this phase is committed.
