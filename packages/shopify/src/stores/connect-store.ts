import { type Prisma, prisma } from "@repo/database";
import { ShopifyGraphqlError, ShopifyTransportError } from "../admin/errors";
import { decryptSecret } from "../crypto";
import { defaultApiVersion } from "../keys";
import { requestClientCredentialsToken } from "../oauth/client-credentials";
import { ShopifyOAuthError } from "../oauth/token-endpoint";
import type { ShopifyTokenResult } from "../oauth/types";
import { InvalidShopDomainError, normalizeShopDomain } from "../shop-domain";
import { recordShopifyAudit } from "./audit";
import { StoreConnectionError, StoreNotFoundError } from "./errors";
import { probeShop, type ShopDetails } from "./health-check";
import {
  type DbClient,
  findApp,
  type ShopifyStoreRecord,
  type StoreScope,
  saveToken,
} from "./store-repository";

export const MAX_STORES_PER_CONNECT_REQUEST = 10;
const CONNECT_CONCURRENCY = 5;

export interface ConnectOptions {
  fetchImpl?: typeof fetch | undefined;
}

type StoredToken = Pick<
  ShopifyTokenResult,
  | "accessToken"
  | "accessTokenExpiresAt"
  | "refreshToken"
  | "refreshTokenExpiresAt"
  | "scopes"
>;

export type ClientCredentialsConnectResult =
  | { ok: true; shopDomain: string; store: ShopifyStoreRecord }
  | { error: string; ok: false; shopDomain: string };

/** Maps a failed Shopify call to the reason a user can act on. */
export const toConnectionError = (error: unknown): StoreConnectionError => {
  if (error instanceof StoreConnectionError) {
    return error;
  }
  if (error instanceof ShopifyTransportError) {
    return new StoreConnectionError(
      "SHOP_UNREACHABLE",
      "Shopify could not be reached for this store. Try again."
    );
  }
  if (error instanceof ShopifyOAuthError) {
    return error.isRejection
      ? new StoreConnectionError(
          "CREDENTIALS_REJECTED",
          `Shopify refused the credentials for this store (${
            error.code ?? `HTTP ${error.httpStatus}`
          }).`
        )
      : new StoreConnectionError(
          "SHOP_UNREACHABLE",
          "Shopify could not be reached for this store. Try again."
        );
  }
  if (error instanceof ShopifyGraphqlError) {
    return new StoreConnectionError(
      "CREDENTIALS_REJECTED",
      error.httpStatus === 401 || error.httpStatus === 403
        ? "Shopify rejected the access token for this store."
        : error.message
    );
  }
  throw error;
};

/**
 * Writes a verified connection: the store row (created, or updated when the
 * domain is being reconnected), its token and the audit entry.
 */
export const persistConnectedStore = async (
  db: DbClient,
  input: {
    actorId: string;
    appId: string | null;
    details: ShopDetails;
    organizationId: string;
    shopDomain: string;
    strategy: ShopifyStoreRecord["strategy"];
    token: StoredToken;
  }
): Promise<ShopifyStoreRecord> => {
  const now = new Date();
  const key = {
    organizationId: input.organizationId,
    shopDomain: input.shopDomain,
  };
  const existing = await db.shopifyStore.findUnique({
    where: { organizationId_shopDomain: key },
  });
  const connection: Prisma.ShopifyStoreUncheckedUpdateInput = {
    appId: input.appId,
    connectedAt: now,
    currencyCode: input.details.currencyCode,
    lastHealthCheckAt: now,
    lastHealthCheckError: null,
    ...(existing?.nameCustomized ? {} : { name: input.details.shopName }),
    scopes: input.details.scopes,
    status: "CONNECTED",
    strategy: input.strategy,
  };
  const store = existing
    ? await db.shopifyStore.update({
        data: connection,
        where: { id: existing.id },
      })
    : await db.shopifyStore.create({
        data: {
          ...key,
          apiVersion: defaultApiVersion(),
          appId: input.appId,
          connectedAt: now,
          createdById: input.actorId,
          currencyCode: input.details.currencyCode,
          lastHealthCheckAt: now,
          name: input.details.shopName,
          scopes: input.details.scopes,
          status: "CONNECTED",
          strategy: input.strategy,
        },
      });
  await db.shopifyOAuthState.deleteMany({ where: { storeId: store.id } });
  await saveToken(store.id, input.token, "revoke", db);
  await recordShopifyAudit(db, {
    action: "shopify.store.connected",
    actorId: input.actorId,
    metadata: {
      reconnected: Boolean(existing),
      shopDomain: store.shopDomain,
      strategy: store.strategy,
    },
    organizationId: store.organizationId,
    targetId: store.id,
    targetType: "ShopifyStore",
  });
  return store;
};

/** Connects a store with an Admin API token the user pasted. */
export const connectStaticTokenStore = async (
  input: {
    accessToken: string;
    actorId: string;
    organizationId: string;
    shopDomain: string;
  },
  options: ConnectOptions = {}
): Promise<ShopifyStoreRecord> => {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  let details: ShopDetails;
  try {
    details = await probeShop({
      accessToken: input.accessToken,
      fetchImpl: options.fetchImpl,
      shopDomain,
    });
  } catch (error) {
    throw toConnectionError(error);
  }
  return prisma.$transaction((transaction) =>
    persistConnectedStore(transaction, {
      actorId: input.actorId,
      appId: null,
      details,
      organizationId: input.organizationId,
      shopDomain,
      strategy: "STATIC_TOKEN",
      token: {
        accessToken: input.accessToken,
        accessTokenExpiresAt: undefined,
        refreshToken: undefined,
        refreshTokenExpiresAt: undefined,
        scopes: details.scopes,
      },
    })
  );
};

/**
 * Connects a store that belongs to the same Shopify organization as a
 * registered app, using the app's own credentials.
 */
export const connectClientCredentialsStore = async (
  input: {
    actorId: string;
    appId: string;
    organizationId: string;
    shopDomain: string;
  },
  options: ConnectOptions = {}
): Promise<ShopifyStoreRecord> => {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  const app = await findApp(input);
  if (!app) {
    throw new StoreConnectionError("APP_NOT_FOUND", "Shopify app not found.");
  }

  let token: ShopifyTokenResult;
  let details: ShopDetails;
  try {
    token = await requestClientCredentialsToken(
      {
        clientId: app.clientId,
        clientSecret: decryptSecret(app.clientSecretEncrypted),
        shop: shopDomain,
      },
      options
    );
    details = await probeShop({
      accessToken: token.accessToken,
      fetchImpl: options.fetchImpl,
      shopDomain,
    });
  } catch (error) {
    throw toConnectionError(error);
  }
  return prisma.$transaction((transaction) =>
    persistConnectedStore(transaction, {
      actorId: input.actorId,
      appId: app.id,
      details,
      organizationId: input.organizationId,
      shopDomain,
      strategy: "CLIENT_CREDENTIALS",
      token,
    })
  );
};

/**
 * Connects several stores under one app. Each domain succeeds or fails on its
 * own; one bad domain never blocks the rest.
 */
export const connectClientCredentialsStores = async (
  input: {
    actorId: string;
    appId: string;
    organizationId: string;
    shopDomains: string[];
  },
  options: ConnectOptions = {}
): Promise<ClientCredentialsConnectResult[]> => {
  if (input.shopDomains.length > MAX_STORES_PER_CONNECT_REQUEST) {
    throw new RangeError(
      `At most ${MAX_STORES_PER_CONNECT_REQUEST} stores can be connected per request.`
    );
  }
  const connectOne = async (
    shopDomain: string
  ): Promise<ClientCredentialsConnectResult> => {
    try {
      const store = await connectClientCredentialsStore(
        { ...input, shopDomain },
        options
      );
      return { ok: true, shopDomain: store.shopDomain, store };
    } catch (error) {
      if (
        error instanceof StoreConnectionError ||
        error instanceof InvalidShopDomainError
      ) {
        return { error: error.message, ok: false, shopDomain };
      }
      throw error;
    }
  };

  const results: ClientCredentialsConnectResult[] = [];
  for (
    let start = 0;
    start < input.shopDomains.length;
    start += CONNECT_CONCURRENCY
  ) {
    const batch = input.shopDomains.slice(start, start + CONNECT_CONCURRENCY);
    results.push(...(await Promise.all(batch.map(connectOne))));
  }
  return results;
};

/** Removes the store's credentials and marks it disconnected. */
export const disconnectStore = (
  scope: StoreScope,
  actorId: string
): Promise<ShopifyStoreRecord> =>
  prisma.$transaction(async (transaction) => {
    const store = await transaction.shopifyStore.findFirst({
      where: { id: scope.storeId, organizationId: scope.organizationId },
    });
    if (!store) {
      throw new StoreNotFoundError(scope.storeId);
    }
    await transaction.shopifyToken.deleteMany({ where: { storeId: store.id } });
    await transaction.shopifyOAuthState.deleteMany({
      where: { storeId: store.id },
    });
    const disconnected = await transaction.shopifyStore.update({
      data: { lastHealthCheckError: null, status: "DISCONNECTED" },
      where: { id: store.id },
    });
    await recordShopifyAudit(transaction, {
      action: "shopify.store.disconnected",
      actorId,
      metadata: { shopDomain: store.shopDomain },
      organizationId: store.organizationId,
      targetId: store.id,
      targetType: "ShopifyStore",
    });
    return disconnected;
  });
