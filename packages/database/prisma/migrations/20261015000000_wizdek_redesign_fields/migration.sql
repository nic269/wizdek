-- CreateEnum
CREATE TYPE "TargetEnvironment" AS ENUM ('PROD', 'STAGING', 'DEV');

-- AlterTable
ALTER TABLE "database_connection" ADD COLUMN     "environment" "TargetEnvironment" NOT NULL DEFAULT 'DEV',
ADD COLUMN     "sslMode" TEXT;

-- AlterTable
ALTER TABLE "shopify_store" ADD COLUMN     "environment" "TargetEnvironment" NOT NULL DEFAULT 'DEV';

-- AlterTable: number existing runs per flow in the order they were created,
-- then require the number on every new run.
ALTER TABLE "flow_run" ADD COLUMN     "number" INTEGER;

UPDATE "flow_run" AS run
SET "number" = numbered.position
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "flowId" ORDER BY "createdAt", "id") AS position
  FROM "flow_run"
) AS numbered
WHERE run."id" = numbered."id";

ALTER TABLE "flow_run" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "flow_run_flowId_number_key" ON "flow_run"("flowId", "number");
