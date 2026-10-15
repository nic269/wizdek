---
title: Wizdek redesign implemented
date: 2026-10-15
summary: "Rebuilt the app to the wizdek Paper design across all ten phases, with the backend fields and endpoints the screens needed"
---

# Wizdek redesign implemented

## What changed

- Phases a–j of `plans/261014-2309-wizdek-redesign/plan.md` landed as one commit each: tokens, shared components, shell, dashboard, flows and run trace, stores, GraphQL console chrome, database, settings/members/access, and the auth pages.
- Backend additions the screens needed: an `environment` on stores and database connections, per-flow run numbers, the caller's permissions, flow versions, organization-wide runs, richer flow rows, store and member counts, multi-prefix audit filtering, and a public invitation preview keyed by the invite token.
- Every list screen has loading, empty, error and read-only states driven by `usePermissions()`.

## Decisions

- The audit filter needed one request to match several prefixes, so `actionPrefix` takes a comma-separated list rather than adding a second parameter.
- The invitation preview is public because the token is already the secret the email carries; it returns no more than the email itself says.
- A signed-out visitor on an invitation sees Create account and Sign in instead of an Accept button that could only fail.

## Problems found on the way

- Phase h dropped the "Backups of deleted connections" section; a sweep of removed UI strings caught it and it is restored. The same sweep found no other lost feature.
- Email verification reported success for any token, because the client followed the server's redirect. The old page had the same flaw.
- `apps/api` crash-resume integration test failed once because the dev API on 3012 shared the job queue and the built API was stale; with the dev API stopped and a fresh build it passes.

## Verification

- Biome on all changed code, type checks (24 tasks), boundaries, unit tests (24 tasks) and integration tests pass.
- E2E against the isolated stack (Postgres 5441, API 3012, app 3010): 16 of 17 pass. Password recovery fails only because it posts with a hard-coded `Origin: http://localhost:3000`.
- Screens were compared with the prototype through screenshots, including Member and Viewer read-only states.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
