-- CreateEnum
CREATE TYPE "DatabaseEngine" AS ENUM ('POSTGRESQL');

-- CreateEnum
CREATE TYPE "DatabaseBackupStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "database_connection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "engine" "DatabaseEngine" NOT NULL,
    "urlEncrypted" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "databaseName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "serverVersion" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "database_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_backup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT,
    "connectionName" TEXT NOT NULL,
    "engine" "DatabaseEngine" NOT NULL,
    "databaseName" TEXT NOT NULL,
    "status" "DatabaseBackupStatus" NOT NULL DEFAULT 'QUEUED',
    "storageProvider" TEXT,
    "objectKey" TEXT,
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "toolVersion" TEXT,
    "serverVersion" TEXT,
    "error" TEXT,
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "database_backup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "database_connection_organizationId_name_key" ON "database_connection"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "database_connection_id_organizationId_key" ON "database_connection"("id", "organizationId");

-- CreateIndex
CREATE INDEX "database_backup_organizationId_createdAt_idx" ON "database_backup"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "database_backup_connectionId_createdAt_idx" ON "database_backup"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "database_backup_status_startedAt_idx" ON "database_backup"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "database_connection" ADD CONSTRAINT "database_connection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_backup" ADD CONSTRAINT "database_backup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_backup" ADD CONSTRAINT "database_backup_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "database_connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
