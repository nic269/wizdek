-- AlterTable
ALTER TABLE "code_function" ADD COLUMN     "httpTokenHash" TEXT,
ADD COLUMN     "httpTokenHint" TEXT;

-- AlterTable
ALTER TABLE "code_function_run" ADD COLUMN     "scheduleId" TEXT;

-- CreateTable
CREATE TABLE "code_function_env_var" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "valueEncrypted" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_function_env_var_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_function_schedule" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_function_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "code_function_env_var_functionId_name_key" ON "code_function_env_var"("functionId", "name");

-- CreateIndex
CREATE INDEX "code_function_schedule_functionId_idx" ON "code_function_schedule"("functionId");

-- CreateIndex
CREATE UNIQUE INDEX "code_function_httpTokenHash_key" ON "code_function"("httpTokenHash");

-- AddForeignKey
ALTER TABLE "code_function_env_var" ADD CONSTRAINT "code_function_env_var_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "code_function"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_function_schedule" ADD CONSTRAINT "code_function_schedule_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "code_function"("id") ON DELETE CASCADE ON UPDATE CASCADE;

