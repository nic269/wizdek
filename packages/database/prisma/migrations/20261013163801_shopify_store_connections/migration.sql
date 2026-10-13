-- CreateEnum
CREATE TYPE "ShopifyCredentialStrategy" AS ENUM ('STATIC_TOKEN', 'OAUTH', 'CLIENT_CREDENTIALS');

-- CreateEnum
CREATE TYPE "ShopifyStoreStatus" AS ENUM ('PENDING', 'CONNECTED', 'RECONNECT_REQUIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ShopifyTokenMode" AS ENUM ('NON_EXPIRING', 'EXPIRING');

-- CreateTable
CREATE TABLE "shopify_app" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT NOT NULL,
    "scopes" TEXT[],
    "installLink" TEXT,
    "tokenMode" "ShopifyTokenMode" NOT NULL DEFAULT 'NON_EXPIRING',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_app_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_store" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" "ShopifyCredentialStrategy" NOT NULL,
    "status" "ShopifyStoreStatus" NOT NULL DEFAULT 'PENDING',
    "scopes" TEXT[],
    "apiVersion" TEXT NOT NULL,
    "currencyCode" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthCheckError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_token" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_oauth_state" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_oauth_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopify_app_organizationId_clientId_key" ON "shopify_app"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "shopify_store_appId_idx" ON "shopify_store"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_store_organizationId_shopDomain_key" ON "shopify_store"("organizationId", "shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_store_id_organizationId_key" ON "shopify_store"("id", "organizationId");

-- CreateIndex
CREATE INDEX "shopify_token_storeId_revokedAt_idx" ON "shopify_token"("storeId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_oauth_state_stateHash_key" ON "shopify_oauth_state"("stateHash");

-- CreateIndex
CREATE INDEX "shopify_oauth_state_storeId_idx" ON "shopify_oauth_state"("storeId");

-- AddForeignKey
ALTER TABLE "shopify_app" ADD CONSTRAINT "shopify_app_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_store" ADD CONSTRAINT "shopify_store_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_store" ADD CONSTRAINT "shopify_store_appId_fkey" FOREIGN KEY ("appId") REFERENCES "shopify_app"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_token" ADD CONSTRAINT "shopify_token_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "shopify_store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_oauth_state" ADD CONSTRAINT "shopify_oauth_state_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "shopify_store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
