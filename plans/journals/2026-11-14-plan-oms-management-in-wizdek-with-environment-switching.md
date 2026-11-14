---
title: Plan OMS management in Wizdek with environment switching
date: 2026-11-14
summary: "Planned isolated OMS app, shared Wizdek login and versioned staging/production/custom connections; no implementation or DB changes."
---

# Plan OMS management in Wizdek with environment switching

## Outcome
Created plans/261114-0133-oms-management-environment-switching with seven implementation phases, architecture, feature matrix, validation and adversarial review. All implementation tasks remain pending.

## Decisions
User confirmed apps/oms-management in Wizdek, shared Wizdek login, two preset environments plus editable/custom connections, and a small OMS command bridge. Shared login does not alter OMS users/sessions/passwords. Profile/revision context isolates each request, tab, pool, cache and operation. OMS-specific code stays app-local; business execution remains in OMS through the authorized bridge.

## Review
Corrected session renewal flow, DB/API identity provisioning, atomic command receipts, old-revision reconciliation, deployment ordering, privilege checks and uninstall draining. Existing root boundary engine is reused. Role retirement remains a separate choice; preserve legacy until explicitly selected and replacement is verified live.

## Verification and limitations
Plan format/link/frontmatter checks passed; no application code, live database or deployments changed. AgentKit reindex accepted the new plan but reported conflicting project identities for two older plans; those files were left unchanged. A shell write was blocked by a context-filter false match on document text; structured file edits completed the plan without changing hooks. Runtime task tool unavailable; plan checklists and plan index are the tracking source.

## Follow-up — 2026-11-14 01:57 Asia/Ho_Chi_Minh
User confirmed: “Gỡ role/công cụ cũ sau khi chuyển đổi đầy đủ”. Updated plan, architecture, matrix, phases 6/7 and validation to make retirement required after full feature parity, live replacement and rollback proof. Phase 6 prepares/dry-runs; phase 7 executes after deployment gates. This supersedes the earlier pending role-retirement choice; no code or DB changes were made.

## Next
Implement only when requested with ak-cook on the plan path. Verify host gateway/durable storage, credentials and schema compatibility during implementation; never paste secrets into plan files. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
