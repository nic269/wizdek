import { randomBytes } from "node:crypto";
import { prisma } from "@repo/database";
import { decryptSecret } from "../crypto/secret-encryption";
import {
  hashOAuthState,
  verifyAndDecodeShopifySessionToken,
  verifyShopifyOAuthHmac,
} from "../oauth/oauth-validation";
import { createShopifyTokenService } from "../oauth/shopify-token-service";
import type { ShopifyTokenResult } from "../oauth/types";
import { InvalidShopDomainError, normalizeShopDomain } from "../shop-domain";
import { recordShopifyAudit } from "./audit";
import {
  type ConnectOptions,
  persistConnectedStore,
  toConnectionError,
} from "./connect-store";
import { StoreConnectionError } from "./errors";
import { probeShop, type ShopDetails } from "./health-check";
import {
  createStore,
  findApp,
  type ShopifyStoreRecord,
  type ShopifyStoreWithApp,
} from "./store-repository";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthBeginResult {
  authorizeUrl: string;
  /** The app's own install link, for stores that install it from Shopify. */
  installLink: string | null;
  store: ShopifyStoreRecord;
}

/**
 * Decides whether the acting user may manage a store. Supplied by the API
 * layer so this package stays unaware of sessions and roles.
 */
export type CanManageStore = (store: ShopifyStoreRecord) => Promise<boolean>;

const invalidCallback = (message: string) =>
  new StoreConnectionError("OAUTH_CALLBACK_INVALID", message);

/**
 * Prepares an OAuth install: a pending store, a single-use state bound to the
 * user, and the authorize URL to send the browser to.
 */
export const beginOAuthConnection = async (input: {
  actorId: string;
  appId: string;
  organizationId: string;
  redirectUri: string;
  shopDomain: string;
}): Promise<OAuthBeginResult> => {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  const app = await findApp(input);
  if (!app) {
    throw new StoreConnectionError("APP_NOT_FOUND", "Shopify app not found.");
  }
  const state = randomBytes(32).toString("base64url");

  const store = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.shopifyStore.findUnique({
      where: {
        organizationId_shopDomain: {
          organizationId: input.organizationId,
          shopDomain,
        },
      },
    });
    const sameConnection =
      existing?.strategy === "OAUTH" && existing.appId === app.id;
    if (existing?.status === "CONNECTED" && !sameConnection) {
      // An abandoned install must not break a store that works today.
      throw new StoreConnectionError(
        "STRATEGY_CONFLICT",
        "This store is already connected another way. Disconnect it before installing through OAuth."
      );
    }
    let pending: ShopifyStoreRecord;
    if (!existing) {
      pending = await createStore(
        {
          appId: app.id,
          createdById: input.actorId,
          organizationId: input.organizationId,
          shopDomain,
          strategy: "OAUTH",
        },
        transaction
      );
    } else if (sameConnection) {
      pending = existing;
    } else {
      pending = await transaction.shopifyStore.update({
        data: { appId: app.id, status: "PENDING", strategy: "OAUTH" },
        where: { id: existing.id },
      });
    }
    await transaction.shopifyOAuthState.create({
      data: {
        createdByUserId: input.actorId,
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
        stateHash: hashOAuthState(state),
        storeId: pending.id,
      },
    });
    await recordShopifyAudit(transaction, {
      action: "shopify.store.oauth_started",
      actorId: input.actorId,
      metadata: { appId: app.id, shopDomain },
      organizationId: input.organizationId,
      targetId: pending.id,
      targetType: "ShopifyStore",
    });
    return pending;
  });

  const authorizeUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
  authorizeUrl.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: input.redirectUri,
    scope: app.scopes.join(","),
    state,
  }).toString();

  return {
    authorizeUrl: authorizeUrl.toString(),
    installLink: app.installLink,
    store,
  };
};

const withApp = (storeId: string): Promise<ShopifyStoreWithApp | null> =>
  prisma.shopifyStore.findUnique({
    include: { app: true },
    where: { id: storeId },
  });

/**
 * Finds the store a callback belongs to. A `state` value is authoritative:
 * when present it must match an unconsumed, unexpired state created by this
 * user, and nothing else is tried.
 */
const resolveCallbackStore = async (input: {
  actorId: string;
  canManage: CanManageStore;
  shopDomain: string;
  state: string | null;
  storeId: string | undefined;
}): Promise<{ stateId: string | undefined; store: ShopifyStoreWithApp }> => {
  if (input.state) {
    const state = await prisma.shopifyOAuthState.findUnique({
      where: { stateHash: hashOAuthState(input.state) },
    });
    const store =
      state &&
      state.consumedAt === null &&
      state.expiresAt.getTime() > Date.now() &&
      state.createdByUserId === input.actorId
        ? await withApp(state.storeId)
        : null;
    if (!(state && store) || store.shopDomain !== input.shopDomain) {
      throw new StoreConnectionError(
        "OAUTH_STATE_INVALID",
        "This install link has expired or was already used. Start the connection again."
      );
    }
    return { stateId: state.id, store };
  }

  if (input.storeId) {
    const store = await withApp(input.storeId);
    if (!store || store.shopDomain !== input.shopDomain) {
      throw new StoreConnectionError(
        "OAUTH_STORE_NOT_FOUND",
        "No pending connection matches this store."
      );
    }
    return { stateId: undefined, store };
  }

  const pending = await prisma.shopifyStore.findMany({
    include: { app: true },
    orderBy: { createdAt: "asc" },
    where: {
      shopDomain: input.shopDomain,
      status: "PENDING",
      strategy: "OAUTH",
    },
  });
  const manageable: ShopifyStoreWithApp[] = [];
  for (const store of pending) {
    if (await input.canManage(store)) {
      manageable.push(store);
    }
  }
  const [only, ...others] = manageable;
  if (!only) {
    throw new StoreConnectionError(
      "OAUTH_STORE_NOT_FOUND",
      "No pending connection matches this store. Start the connection from the Stores page."
    );
  }
  if (others.length > 0) {
    throw new StoreConnectionError(
      "OAUTH_STORE_AMBIGUOUS",
      "Several pending connections match this store. Choose one.",
      {
        candidates: manageable.map((store) => ({
          organizationId: store.organizationId,
          storeId: store.id,
        })),
      }
    );
  }
  return { stateId: undefined, store: only };
};

/**
 * Finishes an OAuth install from the callback query Shopify sent. Callers
 * must already hold a session; the store is never chosen from the callback
 * URL alone.
 */
export const completeOAuthConnection = async (
  input: {
    actorId: string;
    canManage: CanManageStore;
    rawQuery: string;
    storeId?: string | undefined;
  },
  options: ConnectOptions = {}
): Promise<ShopifyStoreRecord> => {
  const query = new URLSearchParams(input.rawQuery);
  let shopDomain: string;
  try {
    shopDomain = normalizeShopDomain(query.get("shop") ?? "");
  } catch (error) {
    if (error instanceof InvalidShopDomainError) {
      throw invalidCallback(
        "The callback does not name a valid Shopify store."
      );
    }
    throw error;
  }
  const code = query.get("code") ?? undefined;
  const idToken = query.get("id_token") ?? undefined;
  if (!(code || idToken)) {
    throw invalidCallback("The callback carries no authorization to exchange.");
  }

  const { stateId, store } = await resolveCallbackStore({
    actorId: input.actorId,
    canManage: input.canManage,
    shopDomain,
    state: query.get("state"),
    storeId: input.storeId,
  });
  if (!(await input.canManage(store))) {
    throw new StoreConnectionError(
      "OAUTH_STORE_NOT_FOUND",
      "No pending connection matches this store."
    );
  }
  if (!store.app) {
    throw new StoreConnectionError("APP_NOT_FOUND", "Shopify app not found.");
  }

  const credentials = {
    clientId: store.app.clientId,
    clientSecret: decryptSecret(store.app.clientSecretEncrypted),
  };
  if (!verifyShopifyOAuthHmac(query, credentials.clientSecret)) {
    throw new StoreConnectionError(
      "OAUTH_SIGNATURE_INVALID",
      "The callback signature does not match this app."
    );
  }
  if (idToken) {
    try {
      verifyAndDecodeShopifySessionToken(
        idToken,
        credentials.clientId,
        credentials.clientSecret,
        shopDomain
      );
    } catch {
      throw new StoreConnectionError(
        "OAUTH_SIGNATURE_INVALID",
        "The session token in the callback is not valid for this app."
      );
    }
  }

  if (stateId) {
    // Consumed before the exchange so a replayed callback stops here.
    const { count } = await prisma.shopifyOAuthState.updateMany({
      data: { consumedAt: new Date() },
      where: { consumedAt: null, id: stateId },
    });
    if (count !== 1) {
      throw new StoreConnectionError(
        "OAUTH_STATE_INVALID",
        "This install link was already used. Start the connection again."
      );
    }
  }

  let token: ShopifyTokenResult;
  let details: ShopDetails;
  try {
    token = await createShopifyTokenService(credentials, {
      expiring: store.app.tokenMode === "EXPIRING",
      fetchImpl: options.fetchImpl,
    }).exchange({ code, idToken, rawQuery: query, shop: shopDomain });
    details = await probeShop({
      accessToken: token.accessToken,
      apiVersion: store.apiVersion,
      fetchImpl: options.fetchImpl,
      shopDomain,
    });
  } catch (error) {
    throw toConnectionError(error);
  }

  return prisma.$transaction((transaction) =>
    persistConnectedStore(transaction, {
      actorId: input.actorId,
      appId: store.appId,
      details,
      organizationId: store.organizationId,
      shopDomain,
      strategy: "OAUTH",
      token,
    })
  );
};
