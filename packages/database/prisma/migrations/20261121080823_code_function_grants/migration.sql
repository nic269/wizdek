-- CreateEnum
CREATE TYPE "CodeFunctionGrantKind" AS ENUM ('STORE', 'DATABASE');

-- AlterTable
ALTER TABLE "code_function_run" ADD COLUMN     "dbCallCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "runtimeTokenHash" TEXT,
ADD COLUMN     "shopifyCallCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "code_function_grant" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "kind" "CodeFunctionGrantKind" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_function_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "code_function_grant_kind_resourceId_idx" ON "code_function_grant"("kind", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "code_function_grant_functionId_kind_resourceId_key" ON "code_function_grant"("functionId", "kind", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "code_function_grant_functionId_alias_key" ON "code_function_grant"("functionId", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "code_function_run_runtimeTokenHash_key" ON "code_function_run"("runtimeTokenHash");

-- AddForeignKey
ALTER TABLE "code_function_grant" ADD CONSTRAINT "code_function_grant_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "code_function"("id") ON DELETE CASCADE ON UPDATE CASCADE;

