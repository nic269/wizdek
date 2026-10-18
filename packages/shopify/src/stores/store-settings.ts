import { prisma } from "@repo/database";
import { ShopifyTransportError } from "../admin/errors";
import { decryptSecret } from "../crypto";
import { ShopifyOAuthError } from "../oauth/token-endpoint";
import { normalizeShopDomain } from "../shop-domain";
import { resolveAccessToken } from "./access-token-resolver";
import { recordShopifyAudit } from "./audit";
import { toConnectionError } from "./connect-store";
import { StoreConnectionError, StoreReconnectRequiredError } from "./errors";
import { probeShop, type ShopDetails } from "./health-check";
import {
  findActiveToken,
  getStore,
  type ShopifyStoreRecord,
  type StoreScope,
  saveToken,
  updateStore,
} from "./store-repository";

export type StoreSecret = "accessToken" | "webhookSecret";

export interface StoreCredentialsChange {
  accessToken?: string | undefined;
  shopDomain?: string | undefined;
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

const domainTaken = (shopDomain: string) =>
  new StoreConnectionError(
    "DOMAIN_TAKEN",
    `Another store in this organization already uses ${shopDomain}.`
  );

/**
 * Gives the store a name of the person's choosing, which health checks and
 * reconnects then keep. `null` goes back to the name Shopify reports, which
 * the next health check fills in.
 */
export const renameStore = (
  scope: StoreScope,
  name: string | null,
  actorId: string
) =>
  prisma.$transaction(async (transaction) => {
    await updateStore(
      scope,
      name === null
        ? { nameCustomized: false }
        : { name, nameCustomized: true },
      transaction
    );
    await recordShopifyAudit(transaction, {
      action: "shopify.store.renamed",
      actorId,
      metadata: { name, reset: name === null },
      organizationId: scope.organizationId,
      targetId: scope.storeId,
      targetType: "ShopifyStore",
    });
  });

/**
 * Changes the domain or the access token of a store connected by a pasted
 * token. The resulting pair is checked against Shopify first; nothing is
 * saved when Shopify refuses it. Stores whose tokens the toolkit obtains
 * itself are reconnected instead.
 */
export const updateStoreCredentials = async (
  scope: StoreScope,
  change: StoreCredentialsChange,
  actorId: string,
  options: { fetchImpl?: typeof fetch | undefined } = {}
): Promise<ShopifyStoreRecord> => {
  const store = await getStore(scope);
  if (store.strategy !== "STATIC_TOKEN") {
    throw new StoreConnectionError(
      "STRATEGY_CONFLICT",
      "Only stores connected by an access token can change their domain or token. Reconnect this store instead."
    );
  }
  const shopDomain = change.shopDomain
    ? normalizeShopDomain(change.shopDomain)
    : store.shopDomain;
  const domainChanged = shopDomain !== store.shopDomain;
  const tokenReplaced = change.accessToken !== undefined;
  if (!(domainChanged || tokenReplaced)) {
    return store;
  }

  let { accessToken } = change;
  if (accessToken === undefined) {
    const current = await findActiveToken(store.id);
    if (!current) {
      throw new StoreConnectionError(
        "CREDENTIALS_REJECTED",
        "No access token is stored for this store. Paste one with the new domain."
      );
    }
    accessToken = decryptSecret(current.accessTokenEncrypted);
  }

  let details: ShopDetails;
  try {
    details = await probeShop({
      accessToken,
      apiVersion: store.apiVersion,
      fetchImpl: options.fetchImpl,
      shopDomain,
    });
  } catch (error) {
    throw toConnectionError(error);
  }

  const now = new Date();
  try {
    return await prisma.$transaction(async (transaction) => {
      if (domainChanged) {
        const other = await transaction.shopifyStore.findUnique({
          where: {
            organizationId_shopDomain: {
              organizationId: store.organizationId,
              shopDomain,
            },
          },
        });
        if (other) {
          throw domainTaken(shopDomain);
        }
      }
      const updated = await transaction.shopifyStore.update({
        data: {
          connectedAt: store.connectedAt ?? now,
          currencyCode: details.currencyCode,
          lastHealthCheckAt: now,
          lastHealthCheckError: null,
          ...(store.nameCustomized ? {} : { name: details.shopName }),
          scopes: details.scopes,
          shopDomain,
          status: "CONNECTED",
        },
        where: { id: store.id },
      });
      if (tokenReplaced) {
        await saveToken(
          store.id,
          {
            accessToken,
            accessTokenExpiresAt: undefined,
            refreshToken: undefined,
            refreshTokenExpiresAt: undefined,
            scopes: details.scopes,
          },
          "revoke",
          transaction
        );
      }
      await recordShopifyAudit(transaction, {
        action: "shopify.store.credentials_updated",
        actorId,
        metadata: {
          shopDomain,
          tokenReplaced,
          ...(domainChanged ? { previousShopDomain: store.shopDomain } : {}),
        },
        organizationId: store.organizationId,
        targetId: store.id,
        targetType: "ShopifyStore",
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw domainTaken(shopDomain);
    }
    throw error;
  }
};

const readAccessToken = async (scope: StoreScope): Promise<string> => {
  try {
    return await resolveAccessToken(scope);
  } catch (error) {
    if (error instanceof StoreReconnectRequiredError) {
      throw new StoreConnectionError("SECRET_NOT_SET", error.message);
    }
    if (
      error instanceof ShopifyOAuthError ||
      error instanceof ShopifyTransportError
    ) {
      throw toConnectionError(error);
    }
    throw error;
  }
};

const readWebhookSecret = async (scope: StoreScope): Promise<string> => {
  const store = await getStore(scope);
  if (store.strategy !== "STATIC_TOKEN") {
    throw new StoreConnectionError(
      "SECRET_NOT_SET",
      "This store's webhooks are signed with its app's client secret."
    );
  }
  if (!store.webhookSecretEncrypted) {
    throw new StoreConnectionError(
      "SECRET_NOT_SET",
      "No webhook secret is saved for this store."
    );
  }
  return decryptSecret(store.webhookSecretEncrypted);
};

/**
 * Returns a store's access token or webhook secret in plaintext, so a person
 * allowed to manage the store can copy it. Each call is audited; the value
 * itself never reaches the audit log.
 */
export const revealStoreSecret = async (
  scope: StoreScope,
  secret: StoreSecret,
  actorId: string
): Promise<string> => {
  const value =
    secret === "accessToken"
      ? await readAccessToken(scope)
      : await readWebhookSecret(scope);
  await recordShopifyAudit(prisma, {
    action: "shopify.store.secret_revealed",
    actorId,
    metadata: { secret },
    organizationId: scope.organizationId,
    targetId: scope.storeId,
    targetType: "ShopifyStore",
  });
  return value;
};
