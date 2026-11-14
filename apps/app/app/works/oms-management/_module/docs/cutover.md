# Legacy privilege cutover — held until verified

**No legacy role, role assignment, bypass, admin route or privileged UI has been removed by this implementation.**

Required evidence before retirement:

- Replacement deployed and healthy at the actual public origin.
- Real shared-cookie login, renewal, revoked/disabled user rejection and independent outage behavior.
- Staging/production cross-target negative tests and custom DB scope/privilege checks.
- Every feature in the plan's feature matrix exercised against the replacement and compared with the old tool, including CSV fallback, Shopify encryption/uniqueness and fraud eligibility. Get shipment documents and standalone waybill downloads are intentionally excluded from Wizdek by user decision; keep the legacy OMS tools unchanged.
- Restart/timeouts, lost response, receipt reconciliation, snapshot restore and backup restore proved.
- Production read-only deployment observed before enabling writes.
- Each existing G_ADMIN user mapped to an appropriate ordinary OMS role; business permissions audited.
- Rollback image checked with the additive receipt table; old runtime maintenance check retained.

Inventory the current source again with:

```sh
pnpm --filter @repo/app exec tsx app/works/oms-management/_module/scripts/audit-legacy-surface.ts /absolute/path/to/oms
```

Classify every reference as assignability/bypass, legacy management surface, ordinary business permission, runtime recovery endpoint or historical data. Do not drop the enum value in the cutover release; it may remain inert for history. Do not retire normal Administrator permissions or the public maintenance decision endpoint.

After all gates pass, remove assignability/bypasses and old management entry points in a separate reviewed cutover change with explicit migration and rollback evidence. User authorization to retire after verification is recorded in the plan; these checks are conditions of that authorization, not optional cleanup.
