---
phase: 6
title: "Compatibility và chuẩn bị chuyển quyền"
status: in-progress
priority: P2
effort: "2d"
dependencies: [5]
---

# Phase 6: Compatibility và chuẩn bị chuyển quyền

## Goal
Chứng minh management không cần OMS role và chuẩn bị gỡ legacy role/tools theo quyết định user; không thay đổi live role trước replacement deployment.

## Ownership / files
App compatibility tests, feature-matrix và runbook. Đọc OMS sidebar/settings/debug/integrations, orders/import-export/fulfillment controls, permission middleware/admin/roles/seed/schema. Chuẩn bị OMS cutover scripts/config/tests để thực hiện quyết định retire đã xác nhận; không thêm OMS permission vào shared Wizdek catalog.

## Tasks & steps
- [ ] P6.1 Inventory G_ADMINISTRATOR/requiresGod/MANAGE_SITE_CONFIG/requireGlobalAdministrator, seed/user-role links. Mỗi reference có disposition; không replace-all.
- [ ] P6.2 Verify management access dùng Wizdek identity + app policy, bridge không giả user/role OMS. Feature matrix đủ parity; normal OMS read-only/Administrator workflows giữ nguyên.
- [x] P6.3 Chuẩn bị per-feature cutover checklist: replacement endpoint, health/parity evidence, rollback owner, old route disposition. Không retire endpoint trong pha này.
- [ ] P6.4 Tạo role-assignment backup/preview/migration scripts và dry-run trên fixtures, including session revocation. Chọn normal OMS role theo từng user/effective permissions; sửa seed/recovery để không tái tạo G_ADMIN. Chưa chạy live ở pha 6.
- [ ] P6.5 Chuẩn bị gated code/config và fixture tests gỡ G_ADMIN bypass, khả năng cấp role và UI/API đặc quyền cũ, preserving normal Administrator behavior và runtime endpoints cần thiết. Không activate live trước gate pha 7.
- [ ] P6.6 Kiểm tra compatibility dữ liệu và enum. Retain historical values trong release này; giá trị lịch sử phải inert/unassignable sau activation, không giữ active G_ADMIN assignment. Không drop enum/schema trong phase.
- [ ] P6.7 Viết và rehearsal recovery/cutover/rollback trên fixtures; bao gồm maintenance enabled và app unavailable. Handover scripts + evidence cho P7, không claim live cutover.

## Verification
Fixtures: read-only user, Administrator, legacy G_ADMIN, allowed/disallowed Wizdek identity và revoked bridge credential. Prove app dùng chung login không tạo/sync OMS users/sessions; normal workflows vẫn đúng. Chạy migration preview/rollback chỉ trên fixtures; live migration và endpoint-denial proof thuộc pha 7.

## Completion gate
Pha 6 complete khi inventory, compatibility proof, retirement runbook và cutover artifacts sẵn sàng. Không cần live retirement để complete; P7 mới deploy và thực thi retirement live sau khi toàn bộ điều kiện chuyển đổi đạt yêu cầu. Vì vậy graph 6 → 7 không có vòng phụ thuộc.

## Risks / response
User đã chọn gỡ role/công cụ cũ sau chuyển đổi đầy đủ (2026-11-14). Chỉ giữ legacy tạm thời trong giai đoạn chuyển tiếp; P7 bắt buộc replacement live/parity/recovery proof trước mọi thay đổi. Gỡ app sau retire sẽ mất UI quản trị; cần runbook thay thế nếu vẫn vận hành OMS.

## Implementation checkpoint — 2026-11-14

Đã có source inventory helper và per-feature cutover conditions/runbook. Chưa thay role/bypass/seed/legacy routes. Role mapping và backup/preview/migration/session revocation artifacts còn pending tới khi có mapping/evidence; không tự thay mọi G_ADMIN bằng Administrator.

Checked tasks reflect implemented local scope; remaining live/expanded verification is not implied. See [implementation evidence](./implementation-report.md).
