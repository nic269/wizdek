-- CreateEnum
CREATE TYPE "CodeFunctionRuntime" AS ENUM ('NODE', 'PYTHON');

-- CreateEnum
CREATE TYPE "CodeFunctionRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELED');

-- CreateEnum
CREATE TYPE "CodeFunctionRunTrigger" AS ENUM ('MANUAL', 'HTTP', 'SCHEDULE');

-- CreateTable
CREATE TABLE "code_function" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "runtime" "CodeFunctionRuntime" NOT NULL,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 60,
    "memoryMb" INTEGER NOT NULL DEFAULT 256,
    "sourceHash" TEXT NOT NULL,
    "paramsSchema" JSONB,
    "paramsError" TEXT,
    "paramsStale" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_function_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_function_file" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "code_function_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_function_run" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "trigger" "CodeFunctionRunTrigger" NOT NULL,
    "status" "CodeFunctionRunStatus" NOT NULL DEFAULT 'QUEUED',
    "params" JSONB NOT NULL,
    "result" JSONB,
    "output" TEXT NOT NULL DEFAULT '',
    "outputTruncated" BOOLEAN NOT NULL DEFAULT false,
    "exitCode" INTEGER,
    "error" TEXT,
    "durationMs" INTEGER,
    "sourceHash" TEXT NOT NULL,
    "cancelRequestedAt" TIMESTAMP(3),
    "startedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "code_function_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "code_function_organizationId_name_key" ON "code_function"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "code_function_file_functionId_path_key" ON "code_function_file"("functionId", "path");

-- CreateIndex
CREATE INDEX "code_function_run_functionId_createdAt_idx" ON "code_function_run"("functionId", "createdAt");

-- CreateIndex
CREATE INDEX "code_function_run_status_createdAt_idx" ON "code_function_run"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "code_function_run_functionId_number_key" ON "code_function_run"("functionId", "number");

-- AddForeignKey
ALTER TABLE "code_function" ADD CONSTRAINT "code_function_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_function_file" ADD CONSTRAINT "code_function_file_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "code_function"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_function_run" ADD CONSTRAINT "code_function_run_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "code_function"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_function_run" ADD CONSTRAINT "code_function_run_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
