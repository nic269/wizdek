# Red-team review — 2026-11-14

Bốn reviewer độc lập: Security/Fact Checker, Failure/Flow Tracer, Assumptions/Scope Auditor, Scope/Contract Verifier. Chỉ đọc source và plan; không chạy application tests. Findings trùng được gộp thành 15 mục: 2 Critical, 11 High, 2 Medium. Các sửa kỹ thuật nằm trong phạm vi lập plan; không triển khai code.

| # | Finding / evidence | Severity | Disposition và xử lý |
|---|---|---|---|
| 1 | Live cutover trước deploy; OMS routes/site-config-maintenance.ts:44, cronjobs.ts:14 | Critical | Accept: pha 6 prepare/rehearse; pha 7 deploy/health/parity trước live cutover |
| 2 | Deploy chạy migration trước replace image; OMS scripts/deploy/deploy-ec2.sh:52 | High | Accept: additive expand release, old-image compatibility, contract release riêng |
| 3 | Cron tạo run trước audit, thiếu operationId; OMS routes/site-config-cronjobs.ts:116, lib/scheduled-jobs/scheduled-job-runner.ts:102 | High | Accept: required receipt, transaction receipt+run/config+audit, wake after commit |
| 4 | Uninstall cắt access khi job chưa terminal; OMS prisma/schema.prisma:1565, scheduled-job-runner.ts:119 | High | Accept: freeze/drain/reconcile trước revoke; unknown giữ recovery access/key |
| 5 | Session helper làm mất renewal headers; WIZDEK packages/auth/src/session.ts:21, packages/api/src/app.ts:187 | High | Accept: Hono identity route, response-header helper, browser same-origin renewal, no RSC cookie mutation |
| 6 | DB/API identity chưa có owner/provision; OMS server.ts:73, prisma/schema.prisma:335 | Critical | Accept modified: existing SiteSetting marker + explicit bootstrap/clone procedure + independent API expected ID/datasource fingerprint, không thêm identity table không cần thiết |
| 7 | Retired revision cấm lease sẽ chặn reconcile; architecture.md section 4; OMS asynchronous scheduled-job-runner.ts:119 | High | Accept: recovery-only lease cho accepted operation, reserve capacity, giữ old credentials |
| 8 | Single-instance assumption không enforce; OMS packages/database/src/client.ts:5, WIZDEK packages/database/src/client.ts:9 | High | Accept: one process/replica, Recreate/no overlap, durable volume, owner/migration lock |
| 9 | Removal/cutover semantics chưa rõ; OMS require-permission.ts:25, seed.ts:33 | High | Accept, resolved 2026-11-14: user chọn gỡ role/công cụ cũ sau chuyển đổi đầy đủ; P6 prepare, P7 execute sau full parity/live proof. Shared login không cần role cleanup |
| 10 | Raw session cookie cùng trust zone; WIZDEK packages/auth/src/middleware.ts:10, session.ts:21 | High | Accept modified: ghi rõ chung auth trust zone + header redaction; không tự thêm SSO assertion platform vì scope chưa yêu cầu security isolation giữa apps |
| 11 | Allowlist có thể cấp mọi quyền production; OMS require-permission.ts:17, site-config-shopify-apps.ts:134 | High | Accept: finite app-local user/profile/capability config, default deny; không shared RBAC catalog |
| 12 | Overprivileged custom credential; OMS prisma/schema.prisma:73,141,300 | High | Accept: explicit privilege ceiling gate + dedicated DB roles/negative tests |
| 13 | Target audit thiếu stable operator subject; OMS prisma/schema.prisma:1953, site-config-maintenance.ts:57 | Medium | Accept: externalActor issuer+subject+display snapshot; subject từ verified server context |
| 14 | Gateway + bridge deployment consumers chưa có owner; WIZDEK next.config.ts:15, OMS deployment/docker-compose.ec2.yml:46 | High | Accept: app-local Caddy/compose samples, rollout owner/actual-host-path discovery, OMS env/deploy secret consumers và startup guards |
| 15 | Duplicate boundary parser; WIZDEK scripts/boundaries/boundary-engine.ts:136, forbidden-imports.ts:9 | Medium | Accept modified: reuse checker + declarative forbidden-import entry; app assertions chỉ kiểm tra graph thiếu, không parser mới |

Evidence abbreviations use roots in architecture.md; OMS route paths above under apps/api/src; schema under packages/database/prisma. Full source inventory retained as nonauthoritative research, including warnings about recommendations superseded by user answers.

## Verification of corrections
Whole-plan sweep checks changes across plan/index/architecture/feature-matrix/all seven phases/validation. No implementation is claimed. Session renewal and network/proxy behavior still need the planned executable tests against pinned dependencies during implementation. DB/API marker provisioning is schema-independent SiteSetting data work, separate from auth.
