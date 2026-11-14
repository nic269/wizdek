> Superseded architecture (2026-11-14): user requested a native `apps/app` route at `/works/oms-management`, under Works → OMS management, using the shared Wizdek shell and design system. See [native-route migration](./native-route-migration.md). Earlier standalone-app/deploy evidence below is historical.

# Feature migration matrix

Không port toàn bộ Orders/Shipments/Returns/Import UI sang management. Phạm vi là các log/settings và thao tác đặc quyền hiện gắn G_ADMIN, cùng kết nối/quản lý môi trường. Inventory dưới đây là baseline local, cần re-scout trước cutover vì OMS tiếp tục phát triển.

| Feature | Owning source trong OMS | Đích và cách thực hiện | Phase |
|---|---|---|---|
| Workflow debug list/detail/filter/error logs | `apps/api/src/routes/debug-workflows.ts` | App-local parameterized DB reads, pagination, account scope explicit | 3 |
| Original import file / reconstructed CSV | Cùng file; `lib/storage/import-upload-storage` | Bridge download có audit, stream; giữ fallback CSV, không clone storage keys | 5 |
| Maintenance enable/exact-path exceptions | `routes/site-config-maintenance.ts` | App-local validated SiteSetting mutation + transaction audit; giữ `/check` runtime endpoint OMS | 4 |
| Cron definitions/status/history | `routes/site-config-cronjobs.ts`, `lib/scheduled-jobs` | DB state + API job catalog (definitions không nằm hết trong DB); thiếu API thì chỉ xem stored records | 3,5 |
| Cron schedule/start/stop/run-now | `routes/site-config-cronjobs.ts` | Bridge dùng scheduler validation/queue/wake hiện hữu | 5 |
| Shopify app configuration/default app/install URLs | `routes/site-config-shopify-apps.ts` | Bridge gọi service hiện hữu, validation/uniqueness/encryption preserved | 5 |
| Shopify webhook signature and raw token reveal | `routes/shopify-stores.ts`, integration drawer | Bridge explicit mutation/reveal, write-only secrets, masked default, audit và no-store | 5 |
| DHL waybill/documents | `routes/dhl-labels.ts` | Bridge scoped lookup + stream remote artifact; không copy DHL secret | 5 |
| Fraud-risk review | `routes/fulfillments.ts:471` | Command UI tối thiểu + bridge reuse eligibility/transition/account rules; không port toàn fulfillment board | 5,6 |
| Role bypass và nonassignable G_ADMIN users | `middleware/require-permission.ts`, `routes/admin.ts`, `routes/roles.ts`, database seed | Classify every reference; chuẩn bị migration user/quyền và gỡ bypass/UI/API cũ; execute sau full parity/live recovery proof theo quyết định user | 6,7 |
| G_ADMIN-only columns/links on orders/import-export | `apps/web/app/(authenticated)/orders`, `import-export`, shared detail components | Inventory cụ thể, move privileged actions hoặc link management; normal OMS workflows giữ nguyên | 6 |

Mỗi feature có task trace tới source route/service, normal user authorization, management authorization, DB/API mode, audit, backup, parity test và cutover state. Tính năng có secret reveal không được omit âm thầm: giữ explicit audited reveal parity, không trả raw token trong list responses.

Gỡ role không có nghĩa bỏ phân quyền nghiệp vụ OMS. Normal Administrator permissions vẫn cần đúng; management access dùng Wizdek identity + app policy + scoped bridge credential. Không biến tất cả logged-in Wizdek users thành operator.

Tháo management khỏi Wizdek chỉ remove app/wiring và revoke service credentials. OMS vẫn chạy nghiệp vụ; các tool quản trị đã chuyển sẽ không còn UI cho đến khi có công cụ thay thế. Không tự re-enable old G_ADMIN routes khi uninstall.
