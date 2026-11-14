---
title: "OMS Management native trong Wizdek: Works và chuyển môi trường"
description: "Route apps/app tại /works/oms-management, shared shell/design system/login, staging/production/custom targets và module dễ tháo bỏ."
status: in-progress
priority: P2
effort: "20d"
branch: main
tags: [feature, frontend, backend, database, auth, infra]
blockedBy: []
blocks: []
created: 2026-11-14
---

> Superseded architecture (2026-11-14): user requested a native `apps/app` route at `/works/oms-management`, under Works → OMS management, using the shared Wizdek shell and design system. See [native-route migration](./native-route-migration.md). Earlier standalone-app/deploy evidence below is historical.



# OMS Management trong Wizdek

## Outcome và phạm vi đã chốt
Tạo route native `/works/oms-management` trong `apps/app` của Wizdek, dùng chung shell, shadcn/design-system và đăng nhập. Nav có Works → OMS management, Debug logs và Settings → Site config. Toàn bộ UI, quy tắc quản trị, DB queries, kết nối, audit và tests riêng OMS nằm trong route module `_module`. Chọn staging/production ngay khi sử dụng, có thể thêm/sửa kết nối để thử DB OMS khác. Không cần role `G_ADMINISTRATOR` để dùng management.

- Constraints: không nhập code giữa các apps; không thêm model/logic OMS vào packages dùng chung; giữ business execution hiện hữu ở OMS qua API bridge nhỏ được user cho phép; backup trước thay đổi schema/data; tách production theo từng request.
- Non-goals: viết lại toàn bộ OMS, console SQL tự do, SSH/server shell, chuyển dữ liệu giữa môi trường, tích hợp provider khác, triển khai thực tế trong phiên lập plan này.
- Acceptance: shared login hoạt động; mỗi request/operation gắn profile + revision; staging/prod và custom DB được kiểm chứng; gỡ app không làm hỏng Wizdek; các tính năng đặc quyền được chuyển hoặc có quyết định thay thế rõ trước khi gỡ role.
- Implementation authorized qua ak-cook. Bảy pha giữ các cổng kiểm chứng: isolation/auth, target routing, đọc, ghi, commands, cutover, deploy/removal. Local implementation không thay thế live parity/UAT.

## Decisions
- Login chung qua một adapter gọi generic Wizdek session helper; browser renewal qua same-origin identity endpoint. Không tạo hệ thống tài khoản thứ hai hoặc import shared database vào logic OMS. Không sửa OMS users/sessions/passwords/schema auth.
- Route thật trong apps/app, cùng public origin và runtime Wizdek; không reverse proxy, iframe hoặc port 4010. `/oms` là compatibility redirect; `/api/auth/*` và `/sign-in` giữ nguyên.
- Profile có DB + optional OMS API + credential references + revision. Hai preset staging/production được seed từ server; override/custom được mã hóa trong storage riêng của app.
- Đọc trực tiếp DB; ghi settings thuần có validation/audit; commands và secrets qua OMS bridge. Custom DB thiếu API vẫn dùng được chế độ đọc.
- Module-local SQLite giữ profiles, revisions, audit/intents; một Node owner trong apps/app có persistent volume. Không lưu state này trong DB Wizdek hoặc các DB OMS.
- Dùng components/styling hiện hữu trong design-system; chỉ generic auth adapter được phép phụ thuộc shared backend. Mọi thay đổi ngoài app phải thuộc danh sách integration allowlist trong kiến trúc.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Foundation, isolation và shared login](./phase-01-start.md) | Implemented locally; real cookie/proxy gate pending |
| 2 | [Profiles và chuyển môi trường](./phase-02-environment-routing-and-isolation.md) | Implemented; fixture tests pass |
| 3 | [Logs và chẩn đoán chỉ đọc](./phase-03-read-only-observability.md) | Implemented; local query/UI checks pass |
| 4 | [Settings, backup và audit](./phase-04-settings-and-audit.md) | Implemented; real PostgreSQL write/restore checks pass |
| 5 | [OMS command bridge](./phase-05-oms-command-bridge.md) | Implemented additively; live provider parity pending |
| 6 | [Compatibility và chuẩn bị chuyển quyền](./phase-06-privilege-cutover.md) | Runbook prepared; role mapping/retirement artifacts pending |
| 7 | [Deploy và chứng minh tháo bỏ](./phase-07-deployment-and-removal-proof.md) | Docker/removal proof pass locally; live deployment pending |

Dependencies: 1 → 2 → 3 → 4 → 5 → 6 → 7. Pha 6 chuẩn bị/rehearse, pha 7 deploy replacement và kiểm chứng trước khi thực thi live cutover đã được user xác nhận. Không mở production trước pha 7.

## Success criteria
- [ ] User đăng nhập Wizdek được vào management theo allowlist của app; session hết hạn/disabled/revoked bị từ chối server-side.
- [ ] Hai tab hai môi trường, switch khi có request/form/job đang chạy, sửa profile, restart và logout không gây lẫn dữ liệu hoặc thao tác.
- [ ] Presets staging/prod và custom DB có kiểm tra kết nối/schema; lỗi một target không chuyển ngầm sang target khác.
- [ ] Tính năng trong feature matrix có parity, authorization và audit; commands không được thay bằng raw SQL.
- [ ] Production có xác nhận đúng môi trường/thao tác; backup có thể khôi phục; không tự retry command chưa rõ kết quả.
- [ ] Build/deploy cùng apps/app; gỡ module + navigation/route wiring vẫn build/test Wizdek, không cần OMS env/secrets.
- [ ] Sau khi thay thế đầy đủ và kiểm chứng live: chuyển user sang quyền OMS thường phù hợp, gỡ G_ADMIN bypass/khả năng cấp role và UI/API quản trị cũ; giữ nguyên nghiệp vụ thường và runtime endpoints cần thiết.

## Tài liệu thực thi
[Architecture và contracts](./architecture.md) · [Feature migration matrix](./feature-matrix.md) · [Evidence và validation](./validation.md) · [Research source inventory](./research/source-inventory.md).
Ước lượng 20 ngày kỹ thuật, gồm integration/test/cutover rehearsal, chưa gồm thời gian chờ hạ tầng/UAT. Không phải cam kết lịch.

## Validation Log
User đã xác nhận repo/folder, shared login, presets + edit/custom profiles, API bridge nhỏ trong OMS và gỡ role/công cụ cũ sau khi chuyển đổi đầy đủ. Chi tiết nguyên văn, kết quả review và các kiểm chứng nằm ở [validation](./validation.md). Những lựa chọn kỹ thuật còn lại là đề xuất của plan, không phải xác nhận của user.

## Handoff
Code hiện nằm tại `apps/app/app/works/oms-management/_module`; generic identity ở Wizdek auth/API; bridge và additive receipt migration trong OMS. Xem [native-route migration](./native-route-migration.md) và [implementation report cũ](./implementation-report.md) cho phạm vi, deviations, kiểm thử và các gate còn lại. Chưa apply migration/deploy vào môi trường thật, chưa commit/push. Không thay đổi OMS auth/users/role assignments; toàn bộ legacy role/tools còn nguyên. Plan giữ `in-progress` tới khi live parity và cutover có đủ bằng chứng.

## Red Team Review
4 reviewer độc lập; [15 findings đã đối chiếu và xử lý trong plan](./red-team-review.md). Sweep đã kiểm tra 12 tài liệu chính, 7 phase, links/frontmatter/task state; format validation pass, 50 implementation tasks pending. Không có application test/deploy trong phiên này. Legacy-role retirement đã được chốt ngày 2026-11-14: gỡ role/công cụ cũ sau khi chuyển đổi đầy đủ; giữ đường cũ trong giai đoạn chuyển tiếp đến khi replacement live, parity và rollback đạt yêu cầu.
