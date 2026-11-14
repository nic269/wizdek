---
phase: 1
title: "Foundation, isolation và shared login"
status: in-progress
priority: P2
effort: "3d"
dependencies: []
---

# Phase 1: Foundation, isolation và shared login

## Goal
App deployable riêng dùng phiên Wizdek, không đưa logic OMS vào shared packages.

## Ownership / files
WIZDEK only. Create app package.json, tsconfig.json, next.config.ts, turbo.json, .env.example, app/layout.tsx, components/management-shell.tsx, server/identity/{wizdek-session,access-policy}.ts, server/http/guard.ts, lib/contracts.ts, boundary-policy tests.
Generic platform: create packages/api/src/identity-route.ts; mount dedicated Hono route in packages/api/src/app.ts. Extend packages/auth/src/session.ts with getCurrentSessionWithHeaders, preserve old getCurrentSession contract; auth/API tests. Modify pnpm-lock.yaml and declarative boundaries.config.json entry only; no OMS logic in shared auth/database.
Giữ nguyên dirty files của user đã ghi ở validation.md.

## Tasks & steps
- [x] P1.1 Record baseline status/release checks/dependency graph. Scaffold @repo/oms-management, compatible Next/React versions, port 4010, Node runtime, basePath /oms. Build không cần live OMS credentials/network.
- [ ] P1.2 Generic Hono GET /api/identity uses getCurrentSessionWithHeaders including ACTIVE/email check, no-store, minimal identity+expiry. Append all Better Auth Set-Cookie headers. Server introspection renew=false; browser shell calls same-origin endpoint on mount/focus/every 10 active minutes to renew. Existing getCurrentSession consumers retain return type/semantics. Test browser cookie expiry actually changes across updateAge (24h), including multiple cookies and logout.
- [x] P1.3 App HTTP identity client fixed trusted origin, only allowlisted session cookies. User-ID/profile/capability policy default deny/read-only unless explicit write/reveal grants; every endpoint independently guarded. No identity cookie/header forwarded to OMS. Mutation CSRF/origin protection.
- [ ] P1.4 Same-origin gateway /oms to separate app; /api và /sign-in remain Wizdek. Safe relative callback, verify assets/RSC/renewal/logout. No cookie-domain widening.
- [x] P1.5 Shell/user/environment area, app-owned QueryClient, loading/denied/error states. Shared UI pure subpaths after transitive audit; no import app shell or shared backend.
- [x] P1.6 Reuse existing boundary engine with forbiddenPackageImports entry for app, plus app-local manifest assertions for transitive runtime deps. check:isolation wraps pnpm --workspace-root boundaries and those assertions, no duplicate parser. Existing app/package-to-app rules cover inbound imports. Remove declarative policy entry during uninstall.

## Verification
Proposed scripts: pnpm --filter @repo/oms-management check-types; test:unit; check:isolation; build. Existing commands: pnpm --filter @repo/api test:unit; pnpm boundaries.
Sign in once opens /oms; disabled/revoked users denied, spoofed actor header denied; identity outage isolates management. Each data/download endpoint guarded, not only shell.

## Risks / response
If same-origin proxy unavailable, revise SSO before deploying. Raw auth get-session alone misses current active-status check. Lazy runtime clients avoid build-time DB access. Phase 2 needs identity and boundary proof.

## Trust boundary
Same-origin shared cookie means management is in Wizdek auth trust zone, not security-isolated from it. No raw header/body logging; Cookie/Set-Cookie/Authorization redacted. Generic auth change has no OMS models/tables/roles.

## Implementation checkpoint — 2026-11-14

Scaffold, generic identity và policy đã implement; build/type/auth/API tests và isolation pass. P1.2/P1.4 còn real-cookie updateAge/renewal/logout và actual gateway proof. Không import shared backend.

Checked tasks reflect implemented local scope; remaining live/expanded verification is not implied. See [implementation evidence](./implementation-report.md).
