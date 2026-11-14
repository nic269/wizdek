---
title: Move OMS management into native Wizdek Works routes
date: 2026-11-14
summary: "Replaced the standalone app with native routes, shared navigation and design-system components while preserving target isolation and legacy OMS tools."
---

# Move OMS management into native Wizdek Works routes

## What changed

The user corrected the deployment shape: OMS management belongs inside apps/app on port 4000, under Works with an OMS management child. The user also explicitly required existing shadcn and design-system styling. Moved the complete management implementation into the route-local _module folder, added native API handlers and feature routes, and removed the separate package and proxy wiring. Stopped the old 4010 server; preserved ignored local runtime data and environment files.

## Verification and fixes

Native build, type checks, boundaries, 64 main app unit tests and 7 config tests passed. A disposable removal rehearsal still builds Wizdek without OMS configuration. Read-only HTTP and browser checks confirm sign-in redirects preserve the intended native route/profile callback.

Independent review caught missing page-level OMS eligibility and dropped session-revocation cookies in the new direct auth adapter. Both were fixed using the same shared policy and forwarding all auth response cookies. API 401 now immediately clears the module's query cache and sensitive UI. Browser fixtures caught an environment select visually switching after a cancelled dirty-form prompt; cancellation now uses the design-system Select event contract before navigation.

## Remaining boundary

No live OMS database change, production deployment, commit or push. Existing G_ADMINISTRATOR role and tools remain intact until full deployed parity and recovery evidence exists. Shared auth and generic nested navigation can stay after removing the module. The route still needs its operator configuration and one persistent control-store owner in the Wizdek app runtime.

See the plan's native-route-migration.md for the current architecture and evidence. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
