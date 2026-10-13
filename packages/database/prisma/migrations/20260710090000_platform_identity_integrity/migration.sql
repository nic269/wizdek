CREATE UNIQUE INDEX "invitation_pending_unique"
ON "invitation" ("organizationId", lower("email"))
WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "integration_connection_global_identity_unique"
ON "integration_connection" ("provider", "externalId")
WHERE "organizationId" IS NULL AND "externalId" IS NOT NULL;

ALTER TABLE "job_run" ADD COLUMN "scopeKey" TEXT;

UPDATE "job_run"
SET "scopeKey" = CASE
  WHEN "organizationId" IS NULL THEN 'global'
  ELSE 'organization:' || "organizationId"
END;

ALTER TABLE "job_run"
ALTER COLUMN "scopeKey" SET NOT NULL,
ALTER COLUMN "scopeKey" SET DEFAULT 'global';

DROP INDEX "job_run_name_idempotencyKey_key";

CREATE UNIQUE INDEX "job_run_scopeKey_name_idempotencyKey_key"
ON "job_run" ("scopeKey", "name", "idempotencyKey");
