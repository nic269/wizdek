-- CreateEnum
CREATE TYPE "FlowActivationStatus" AS ENUM ('ACTIVE', 'FAILED', 'INACTIVE');

-- AlterTable
ALTER TABLE "shopify_store" ADD COLUMN     "webhookSecretEncrypted" TEXT;

-- CreateTable
CREATE TABLE "flow_activation" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "status" "FlowActivationStatus" NOT NULL,
    "webhookSubscriptionId" TEXT,
    "error" TEXT,
    "activatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_activation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flow_activation_storeId_idx" ON "flow_activation"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "flow_activation_flowId_storeId_key" ON "flow_activation"("flowId", "storeId");

-- AddForeignKey
ALTER TABLE "flow_activation" ADD CONSTRAINT "flow_activation_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_activation" ADD CONSTRAINT "flow_activation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "shopify_store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_activation" ADD CONSTRAINT "flow_activation_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "flow_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
