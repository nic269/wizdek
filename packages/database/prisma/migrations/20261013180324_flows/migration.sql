-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FlowRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "FlowStepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FlowItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "flow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FlowStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_version" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_run" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "FlowRunStatus" NOT NULL DEFAULT 'QUEUED',
    "triggerType" TEXT NOT NULL,
    "triggerPayload" JSONB,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_run_step" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" "FlowStepStatus" NOT NULL DEFAULT 'PENDING',
    "state" JSONB,
    "error" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "flow_run_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_run_item" (
    "id" TEXT NOT NULL,
    "ordinal" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "status" "FlowItemStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "outputHandle" TEXT,
    "error" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_run_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flow_organizationId_updatedAt_idx" ON "flow"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "flow_version_flowId_version_key" ON "flow_version"("flowId", "version");

-- CreateIndex
CREATE INDEX "flow_run_flowId_createdAt_idx" ON "flow_run"("flowId", "createdAt");

-- CreateIndex
CREATE INDEX "flow_run_organizationId_createdAt_idx" ON "flow_run"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "flow_run_step_runId_nodeId_key" ON "flow_run_step"("runId", "nodeId");

-- CreateIndex
CREATE INDEX "flow_run_item_runId_nodeId_status_ordinal_idx" ON "flow_run_item"("runId", "nodeId", "status", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "flow_run_item_runId_nodeId_itemKey_key" ON "flow_run_item"("runId", "nodeId", "itemKey");

-- AddForeignKey
ALTER TABLE "flow" ADD CONSTRAINT "flow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_version" ADD CONSTRAINT "flow_version_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "flow_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "shopify_store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_run_step" ADD CONSTRAINT "flow_run_step_runId_fkey" FOREIGN KEY ("runId") REFERENCES "flow_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_run_item" ADD CONSTRAINT "flow_run_item_runId_fkey" FOREIGN KEY ("runId") REFERENCES "flow_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
