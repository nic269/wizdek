-- CreateEnum
CREATE TYPE "CodeFunctionDepsStatus" AS ENUM ('NONE', 'BUILDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "code_function" ADD COLUMN     "depsBuiltAt" TIMESTAMP(3),
ADD COLUMN     "depsError" TEXT,
ADD COLUMN     "depsHash" TEXT,
ADD COLUMN     "depsKey" TEXT,
ADD COLUMN     "depsLog" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "depsStatus" "CodeFunctionDepsStatus" NOT NULL DEFAULT 'NONE';
