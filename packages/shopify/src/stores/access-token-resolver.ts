import { prisma } from "@repo/database";
import { decryptSecret } from "../crypto/secret-encryption";
import { requestClientCredentialsToken } from "../oauth/client-credentials";
import { refreshAccessToken } from "../oauth/refresh-access-token";
import { ShopifyOAuthError } from "../oauth/token-endpoint";
import type {
  ShopifyAppCredentials,
  ShopifyTokenRequestOptions,
  ShopifyTokenResult,
} from "../oauth/types";
import { StoreReconnectRequiredError } from "./errors";
import {
  type DbClient,
  findActiveToken,
  getStore,
  markStoreReconnectRequired,
  type ShopifyStoreWithApp,
  type ShopifyTokenRecord,
  type StoreScope,
  saveToken,
} from "./store-repository";

/** Tokens this close to expiry are renewed before use. */
export const TOKEN_RENEWAL_MARGIN_MS = 5 * 60 * 1000;

/** Room for one token request (30 s) plus the queries around it. */
const RENEWAL_TRANSACTION_TIMEOUT_MS = 45_000;

export type ResolveAccessTokenOptions = ShopifyTokenRequestOptions;

const isUsable = (
  token: ShopifyTokenRecord | null
): token is ShopifyTokenRecord =>
  token !== null &&
  (token.accessTokenExpiresAt === null ||
    token.accessTokenExpiresAt.getTime() - Date.now() >
      TOKEN_RENEWAL_MARGIN_MS);

const appCredentials = (store: ShopifyStoreWithApp): ShopifyAppCredentials => {
  if (!store.app) {
    throw new StoreReconnectRequiredError(
      store.id,
      "The store is not linked to a Shopify app."
    );
  }
  return {
    clientId: store.app.clientId,
    clientSecret: decryptSecret(store.app.clientSecretEncrypted),
  };
};

const requestRenewal = (
  store: ShopifyStoreWithApp,
  current: ShopifyTokenRecord | null,
  options: ResolveAccessTokenOptions
): Promise<ShopifyTokenResult> => {
  const credentials = appCredentials(store);
  if (store.strategy === "CLIENT_CREDENTIALS") {
    return requestClientCredentialsToken(
      { ...credentials, shop: store.shopDomain },
      options
    );
  }
  if (!current?.refreshTokenEncrypted) {
    throw new StoreReconnectRequiredError(
      store.id,
      "The access token expired and no refresh token is stored."
    );
  }
  return refreshAccessToken(
    {
      ...credentials,
      refreshToken: decryptSecret(current.refreshTokenEncrypted),
      shop: store.shopDomain,
    },
    options
  );
};

/**
 * Renews under a per-store advisory lock. Shopify rotates the refresh token on
 * every refresh, so two concurrent refreshes would invalidate each other; the
 * second caller waits, then finds the token the first one stored.
 */
const renewUnderLock = (
  store: ShopifyStoreWithApp,
  options: ResolveAccessTokenOptions
): Promise<string> =>
  prisma.$transaction(
    async (transaction: DbClient) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${store.id}, 0))::text AS locked`;

      const current = await findActiveToken(store.id, transaction);
      if (isUsable(current)) {
        return decryptSecret(current.accessTokenEncrypted);
      }

      const renewed = await requestRenewal(store, current, options);
      await saveToken(
        store.id,
        {
          ...renewed,
          scopes: renewed.scopes.length > 0 ? renewed.scopes : store.scopes,
        },
        "rotate",
        transaction
      );
      return renewed.accessToken;
    },
    {
      maxWait: RENEWAL_TRANSACTION_TIMEOUT_MS,
      timeout: RENEWAL_TRANSACTION_TIMEOUT_MS,
    }
  );

/**
 * Returns a plaintext access token for the store, renewing it first when the
 * credential strategy allows and the stored one is missing or near expiry.
 * This is the only exported function that returns a decrypted secret.
 */
export const resolveAccessToken = async (
  scope: StoreScope,
  options: ResolveAccessTokenOptions = {}
): Promise<string> => {
  const store = await getStore(scope);
  const current = await findActiveToken(store.id);

  if (isUsable(current)) {
    return decryptSecret(current.accessTokenEncrypted);
  }

  if (store.strategy === "STATIC_TOKEN") {
    throw new StoreReconnectRequiredError(
      store.id,
      "No access token is stored for this store."
    );
  }

  try {
    return await renewUnderLock(store, options);
  } catch (error) {
    const rejected =
      error instanceof StoreReconnectRequiredError ||
      (error instanceof ShopifyOAuthError && error.isRejection);
    if (!rejected) {
      throw error;
    }
    // Recorded outside the renewal transaction, which has rolled back.
    await markStoreReconnectRequired(scope, error.message);
    throw error instanceof StoreReconnectRequiredError
      ? error
      : new StoreReconnectRequiredError(store.id, error.message);
  }
};
