import { type Prisma, prisma } from "@repo/database";
import { encryptSecret } from "../crypto/secret-encryption";
import { defaultApiVersion } from "../keys";
import type { ShopifyTokenResult } from "../oauth/types";
import { normalizeShopDomain } from "../shop-domain";
import { StoreNotFoundError } from "./errors";

export type DbClient = Prisma.TransactionClient;
export type ShopifyStoreRecord = Prisma.ShopifyStoreGetPayload<object>;
export type ShopifyAppRecord = Prisma.ShopifyAppGetPayload<object>;
export type ShopifyTokenRecord = Prisma.ShopifyTokenGetPayload<object>;
export type ShopifyStoreWithApp = Prisma.ShopifyStoreGetPayload<{
  include: { app: true };
}>;

export interface StoreScope {
  organizationId: string;
  storeId: string;
}

const MAX_ERROR_LENGTH = 2000;

export const listStores = (
  organizationId: string,
  db: DbClient = prisma
): Promise<ShopifyStoreRecord[]> =>
  db.shopifyStore.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    where: { organizationId },
  });

export const findStore = (
  { organizationId, storeId }: StoreScope,
  db: DbClient = prisma
): Promise<ShopifyStoreWithApp | null> =>
  db.shopifyStore.findFirst({
    include: { app: true },
    where: { id: storeId, organizationId },
  });

export const getStore = async (
  scope: StoreScope,
  db: DbClient = prisma
): Promise<ShopifyStoreWithApp> => {
  const store = await findStore(scope, db);
  if (!store) {
    throw new StoreNotFoundError(scope.storeId);
  }
  return store;
};

export const createStore = (
  input: {
    apiVersion?: string | undefined;
    appId?: string | undefined;
    createdById?: string | undefined;
    name?: string | undefined;
    organizationId: string;
    shopDomain: string;
    strategy: ShopifyStoreRecord["strategy"];
  },
  db: DbClient = prisma
): Promise<ShopifyStoreRecord> => {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  return db.shopifyStore.create({
    data: {
      apiVersion: input.apiVersion ?? defaultApiVersion(),
      appId: input.appId ?? null,
      createdById: input.createdById ?? null,
      name: input.name ?? shopDomain,
      organizationId: input.organizationId,
      shopDomain,
      strategy: input.strategy,
    },
  });
};

export const updateStore = async (
  scope: StoreScope,
  data: Prisma.ShopifyStoreUncheckedUpdateManyInput,
  db: DbClient = prisma
): Promise<void> => {
  const { count } = await db.shopifyStore.updateMany({
    data,
    where: { id: scope.storeId, organizationId: scope.organizationId },
  });
  if (count === 0) {
    throw new StoreNotFoundError(scope.storeId);
  }
};

export const deleteStore = async (
  scope: StoreScope,
  db: DbClient = prisma
): Promise<void> => {
  const { count } = await db.shopifyStore.deleteMany({
    where: { id: scope.storeId, organizationId: scope.organizationId },
  });
  if (count === 0) {
    throw new StoreNotFoundError(scope.storeId);
  }
};

export const markStoreReconnectRequired = (
  scope: StoreScope,
  reason: string,
  db: DbClient = prisma
): Promise<void> =>
  updateStore(
    scope,
    {
      lastHealthCheckError: reason.slice(0, MAX_ERROR_LENGTH),
      status: "RECONNECT_REQUIRED",
    },
    db
  );

/** The token currently in use: neither revoked nor replaced by a rotation. */
export const findActiveToken = (
  storeId: string,
  db: DbClient = prisma
): Promise<ShopifyTokenRecord | null> =>
  db.shopifyToken.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    where: { revokedAt: null, rotatedAt: null, storeId },
  });

/**
 * Stores a token as the store's active one. Earlier active tokens are marked
 * rotated when the new token continues the same grant, or revoked when the
 * credentials themselves were replaced.
 */
export const saveToken = async (
  storeId: string,
  token: Pick<
    ShopifyTokenResult,
    | "accessToken"
    | "accessTokenExpiresAt"
    | "refreshToken"
    | "refreshTokenExpiresAt"
    | "scopes"
  >,
  supersede: "rotate" | "revoke",
  db: DbClient = prisma
): Promise<ShopifyTokenRecord> => {
  const now = new Date();
  await db.shopifyToken.updateMany({
    data: supersede === "rotate" ? { rotatedAt: now } : { revokedAt: now },
    where: { revokedAt: null, rotatedAt: null, storeId },
  });
  return db.shopifyToken.create({
    data: {
      accessTokenEncrypted: encryptSecret(token.accessToken),
      accessTokenExpiresAt: token.accessTokenExpiresAt ?? null,
      refreshTokenEncrypted: token.refreshToken
        ? encryptSecret(token.refreshToken)
        : null,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt ?? null,
      scopes: token.scopes,
      storeId,
    },
  });
};

export const listApps = (
  organizationId: string,
  db: DbClient = prisma
): Promise<ShopifyAppRecord[]> =>
  db.shopifyApp.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    where: { organizationId },
  });

export const findApp = (
  scope: { appId: string; organizationId: string },
  db: DbClient = prisma
): Promise<ShopifyAppRecord | null> =>
  db.shopifyApp.findFirst({
    where: { id: scope.appId, organizationId: scope.organizationId },
  });

export const createApp = (
  input: {
    clientId: string;
    clientSecret: string;
    createdById?: string | undefined;
    installLink?: string | undefined;
    name: string;
    organizationId: string;
    scopes: string[];
    tokenMode?: ShopifyAppRecord["tokenMode"] | undefined;
  },
  db: DbClient = prisma
): Promise<ShopifyAppRecord> =>
  db.shopifyApp.create({
    data: {
      clientId: input.clientId,
      clientSecretEncrypted: encryptSecret(input.clientSecret),
      createdById: input.createdById ?? null,
      installLink: input.installLink ?? null,
      name: input.name,
      organizationId: input.organizationId,
      scopes: input.scopes,
      tokenMode: input.tokenMode ?? "NON_EXPIRING",
    },
  });
