# Validation và evidence

> Planning evidence below is historical. Implementation is now recorded in [implementation-report.md](./implementation-report.md); its test/deployment status supersedes earlier “no implementation” notes.

## User validation — 2026-11-14, Asia/Ho_Chi_Minh
Questions asked: 3. Đã nhận đủ 3 câu trả lời; không có lựa chọn quan trọng nào bị suy diễn từ thời gian chờ.

1. **Architecture** — “Mình sẽ mặc định dùng đăng nhập riêng cho OMS management, không phụ thuộc auth/DB của Wizdek. Bạn muốn chọn cách nào?”
   - Options: “Đăng nhập riêng, tài khoản quản trị được tạo sẵn” | “Dùng chung đăng nhập Wizdek”.
   - Answer: **Dùng chung đăng nhập Wizdek**.
   - Impact: P1 shared identity HTTP contract/same-origin gateway; P2 control storage không có auth tables; P7 logout/renewal/dependency tests. Không còn independent-login mặc định.
2. **Profiles** — “Với staging/production, bạn muốn khai báo sẵn kết nối phía server rồi chọn môi trường trên UI, hay quản lý thêm/sửa kết nối ngay trong app?”
   - Options: “Khai báo sẵn phía server, UI chỉ chọn môi trường” | “Thêm/sửa kết nối ngay trong app”.
   - Custom input nguyên văn: “mình muốn khai báo sẵn cho 2 môi trường staging và prod, và có thể 1 lựa chọn sửa kết nối ngay trong app nữa luôn (làm sẵn cho trường hợp mình muốn thử trên 1 DB khác của OMS)”.
   - Impact: P2 presets + editor + custom profiles/revisions/encryption; P3/P4/P5 capabilities and old-revision handling; P7 restore/rotation tests.
3. **Integration** — “Các thao tác như chạy cronjob/retry cần logic OMS. Plan có thể bao gồm một API nội bộ nhỏ trong repo OMS, trong khi toàn bộ UI và tools vẫn ở apps/oms-management chứ?”
   - Options: “Có, cho phép lớp API nội bộ nhỏ trong OMS” | “Không sửa OMS, chỉ quản lý qua DB”.
   - Answer: **Có, cho phép lớp API nội bộ nhỏ trong OMS**.
   - Impact: P5 scoped bridge + existing business execution; P6 coordinated cutover. Không dùng fake G_ADMIN service session.

User cũng xác nhận plan nằm trong Wizdek và app là apps/oms-management; không đưa Wizdek vào OMS.

## Verified source facts
Evidence roots defined in architecture.md. Đây là local code, không chứng minh deployment/live schema hiện tại.

| Claim | Evidence |
|---|---|
| Wizdek workspace includes apps/* | WIZDEK/pnpm-workspace.yaml:1 |
| Existing frontend API rewrite bound to one API origin | WIZDEK/apps/app/next.config.ts:5 |
| Shared Prisma singleton uses DATABASE_URL | WIZDEK/packages/database/src/client.ts:5 |
| Auth imports shared database/config/mail | WIZDEK/packages/auth/src/auth-options.ts:1 |
| getCurrentSession checks current user ACTIVE/email policy | WIZDEK/packages/auth/src/session.ts:21 |
| Sign-in callback supports relative destination | WIZDEK/apps/app/app/(auth)/sign-in/page.tsx:7 |
| Callback validator rejects external/control paths | WIZDEK/packages/auth/src/callback-url.ts:11 |
| Generic API contract/router registration exists | WIZDEK/packages/api/src/contracts/index.ts:32; routers/index.ts:15 |
| Generic identity endpoint is proposed, not current | WIZDEK/packages/api/src/contracts/index.ts:32 has no identity contract |
| Root dev runs Wizdek migration preflight | WIZDEK/package.json:21 |
| Root postinstall generates shared Prisma only when schema exists | WIZDEK/scripts/postinstall.mjs:4 |
| Root Turbo uses strict env | WIZDEK/turbo.json:5 |
| Root Docker has fixed app/api runtime paths | WIZDEK/Dockerfile:57 |
| Generic boundary checker forbids app-to-app/package-to-app | WIZDEK/scripts/boundaries/boundary-engine.ts:28 |
| Debug workflows protected by G_ADMIN | OMS/apps/api/src/routes/debug-workflows.ts:17 |
| Cron GET initializes config; writes wake scheduler | OMS/apps/api/src/routes/site-config-cronjobs.ts:19, 76 |
| Maintenance exact-path validation plus transaction audit | OMS/apps/api/src/routes/site-config-maintenance.ts:8, 54 |
| Shopify app configuration owns encryption/redaction | OMS/apps/api/src/routes/site-config-shopify-apps.ts:10, 34 |
| Raw Shopify token/signature depends on G_ADMIN | OMS/apps/api/src/routes/shopify-stores.ts:216 |
| DHL waybill/documents privileged routes | OMS/apps/api/src/routes/dhl-labels.ts:166 |
| Fraud review has G_ADMIN gate | OMS/apps/api/src/routes/fulfillments.ts:471 |
| AuditLog actorId references OMS User | OMS/packages/database/prisma/schema.prisma:1953 |
| Existing role permission bypass | OMS/apps/api/src/middleware/require-permission.ts:25 |
| OMS server mounts existing diagnostic/config routes | OMS/apps/api/src/server.ts:27, 87 |
| OMS API tests use Jest | OMS/apps/api/package.json:21 |

Flow checks: cron patch → validate → config/audit transaction → wake; maintenance patch → parse → setting/audit transaction; Wizdek getCurrentSession → Better Auth session → current DB user status. These source flows justify DB-only vs bridge split.

State lifetime audit: selected profile belongs to tab URL; immutable binding to request/operation; pool registry process-scoped keyed revision; confirmations actor+operation-scoped; SQLite revision/audit persistent; no global active DB. SSR QueryClient per request, client cache per authenticated app session.

Contract consumers after review: generic identity uses new packages/api/src/identity-route.ts mounted in app.ts and helper in packages/auth/src/session.ts; existing getCurrentSession callers keep return contract, add auth/API tests and API documentation. It deliberately does not use oRPC response plumbing. OMS bridge affects listed existing handlers/services, env/deploy consumers and source tests. Existing consumers retain contracts until cutover. All proposed files are marked as new work, not claimed present.

## Primary documentation consulted
- [TanStack Query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys): cache identity includes variables used by query; plan includes profile/revision/account/actor.
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting): independent Node deployment and explicit cache/multiple-instance considerations; plan uses dynamic/no-store management data.
- [Turborepo package configurations](https://turborepo.dev/docs/reference/package-configurations): app-local turbo.json can extend root without applying app env config to peers.
- [Prisma connection pools](https://docs.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool): pool lifecycle/budget per client/driver; app reuses bounded revision-keyed clients.
- [Prisma multiple databases](https://www.prisma.io/docs/guides/database/multiple-databases): distinct connections/clients possible; plan never mutates shared singleton.
- [PostgreSQL privileges](https://www.postgresql.org/docs/current/ddl-priv.html): table/column/action grants; ORM alone is not permission boundary.

## Scope and baseline
No implementation or live DB access. Dirty Wizdek baseline: apps/app/app/lib/option-select.tsx, apps/app/app/shell/nav.tsx, packages/config/src/navigation.test.ts, packages/config/src/navigation.ts, untracked apps/app/app/shopify/. Plan must not absorb/revert them. OMS checkout clean before/after research.

User request supplies authorization for plan files in Wizdek despite session default paths pointing at OMS. Original CLI timestamp used UTC; directory normalized to 261114-0133 according to user timezone. All plan states pending.

## Review and mechanical verification
Four-lens adversarial review completed; 15 consolidated findings and corrections in [red-team-review](./red-team-review.md). Format validation already passes with 7 phases and 50 unchecked implementation tasks. This is document validation, not application validation.

## Deployment prerequisites not yet verified
### Whole-plan consistency sweep
- Files reread: plan.md, architecture.md, feature-matrix.md, all 7 phase files, red-team-review.md và validation.md; source research được đánh dấu nonauthoritative.
- Deltas checked: shared login/no auth DB change; Hono renewal; custom editable profiles; per-capability policy; marker/fingerprint provisioning; atomic receipts; recovery leases; single-instance enforcement; boundary-checker reuse; live-order; confirmed role retirement after full migration; drain before uninstall.
- Stale contract-router identity proposal, duplicate checker path, unconditional live P6 wording và wording “atomic where possible” đã được sửa. Không còn contradiction về phase completion; P6 chỉ chuẩn bị/rehearse, P7 live theo lựa chọn.
- Mechanical result: 12 tài liệu chính, 7 pha; no broken local links/frontmatter/templates; ak plan validate passes; 50 unchecked tasks, 0 implementation complete.
- Verification tier: Full (4 review roles). Source claims verified against local source; live deployment/DB assumptions below remain unverified. No application tests run.
- Tracking: discovered no runtime task-management tool; checklists + AgentKit plan index giữ task state. New plan indexed. Two older plan identities conflict on reindex; no changes to their files.

### Follow-up validation — legacy role
Question asked: “Để tách rõ việc tạo app khỏi thay đổi OMS hiện tại: bạn muốn trước mắt giữ nguyên role/công cụ cũ, hay lên kế hoạch gỡ chúng sau khi management mới đã chạy ổn? Shared login không cần thay đổi role nào trong OMS DB.”
Options: “Giữ nguyên trước; app mới không phụ thuộc role OMS” | “Gỡ role/công cụ cũ sau khi chuyển đổi đầy đủ”.
Answer (2026-11-14, 01:57 Asia/Ho_Chi_Minh), nguyên văn: **“Gỡ role/công cụ cũ sau khi chuyển đổi đầy đủ”**.
Confirmed decision: retirement là scope bắt buộc sau full migration/parity/live recovery proof, không còn là optional/default giữ legacy. Role cũ chỉ tồn tại tạm thời trong chuyển tiếp. Không sửa OMS auth DB để shared login.
<!-- Updated: Validation Session 2 - confirmed legacy role and tools retirement after full migration -->
Propagation: plan.md, architecture.md, feature-matrix.md, P6, P7 và red-team-review.md. P6 chỉ chuẩn bị/dry-run; P7 deploy replacement, kiểm chứng đầy đủ rồi migrate assignments/gỡ bypass/retire privileged UI/API. Không gỡ normal OMS permissions hay maintenance runtime check.
Consistency sweep: quyết định đã propagate toàn bộ tài liệu thực thi; không còn câu chờ chọn giữ/gỡ. Tất cả implementation checkboxes vẫn pending; việc xác nhận plan không phải triển khai live.
User còn hỏi shared login có sửa OMS DB không: answer không cần auth schema/data change; identity ở Wizdek, không sync users. Profile binding/command receipts/confirmed post-migration role retirement là separate OMS data/schema work có backup.

### Remaining deployment inputs
- [UNVERIFIED] Actual Wizdek public origin/proxy owner and host support for one durable-volume instance.
- [UNVERIFIED] Staging/production DB/API addresses, schema drift, account scope, credentials, grants and backup locations.
- [UNVERIFIED] Initial allowlisted Wizdek user IDs, retention policy and exact normal-role assignments for old G_ADMIN users.

These are implementation discovery inputs, not reasons to request secrets in chat or connect to production during planning. Do not enable live writes/cutover before verifying them.
