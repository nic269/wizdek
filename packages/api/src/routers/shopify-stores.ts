import { keys } from "@repo/auth/keys";
import { hasPermission } from "@repo/auth/permissions";
import { countStoreUsage, deactivateStoreActivations } from "@repo/flows";
import { encryptSecret } from "@repo/shopify/crypto";
import {
  beginOAuthConnection,
  completeOAuthConnection,
  connectClientCredentialsStores,
  connectStaticTokenStore,
  disconnectStore,
  getStore,
  listStores,
  runStoreHealthCheck,
  type ShopifyStoreRecord,
  type StoreEnvironment,
  setStoreEnvironment,
  updateStore,
} from "@repo/shopify/stores";
import { getJobProvider } from "../jobs";
import { SHOPIFY_OAUTH_CALLBACK_PATH } from "../shopify-oauth-callback";
import {
  requireOrganizationAccess,
  requireStorePermission,
  requireUser,
} from "./authz";
import { os } from "./implementer";
import { withShopifyErrors } from "./shopify-errors";

export const toPublicStore = (store: ShopifyStoreRecord) => ({
  apiVersion: store.apiVersion,
  appId: store.appId,
  connectedAt: store.connectedAt,
  createdAt: store.createdAt,
  currencyCode: store.currencyCode,
  environment: store.environment,
  hasWebhookSecret: Boolean(store.webhookSecretEncrypted),
  id: store.id,
  lastHealthCheckAt: store.lastHealthCheckAt,
  lastHealthCheckError: store.lastHealthCheckError,
  name: store.name,
  organizationId: store.organizationId,
  scopes: store.scopes,
  shopDomain: store.shopDomain,
  status: store.status,
  strategy: store.strategy,
  updatedAt: store.updatedAt,
});

const scopeOf = (store: ShopifyStoreRecord) => ({
  organizationId: store.organizationId,
  storeId: store.id,
});

const requireManager = (headers: Headers, organizationId: string) =>
  requireOrganizationAccess(headers, organizationId, "stores", "manage");

/** Applies the environment chosen on connect, when it differs. */
const applyEnvironment = async (
  store: ShopifyStoreRecord,
  environment: StoreEnvironment | undefined,
  actorId: string
) => {
  if (!environment || store.environment === environment) {
    return store;
  }
  await setStoreEnvironment(scopeOf(store), environment, actorId);
  return getStore(scopeOf(store));
};

export const shopifyStoresRouter = {
  beginOAuth: os.shopifyStores.beginOAuth.handler(
    async ({ context, input }) => {
      const { environment, ...connection } = input;
      const user = await requireManager(context.headers, input.organizationId);
      const redirectUrl = new URL(
        SHOPIFY_OAUTH_CALLBACK_PATH,
        keys().NEXT_PUBLIC_APP_URL
      ).toString();
      const result = await withShopifyErrors(() =>
        beginOAuthConnection({
          ...connection,
          actorId: user.id,
          redirectUri: redirectUrl,
        })
      );
      return {
        data: {
          authorizeUrl: result.authorizeUrl,
          installLink: result.installLink,
          redirectUrl,
          store: toPublicStore(
            await applyEnvironment(result.store, environment, user.id)
          ),
        },
      };
    }
  ),
  checkHealth: os.shopifyStores.checkHealth.handler(
    async ({ context, input }) => {
      const { store } = await requireStorePermission(
        context.headers,
        input.storeId,
        "stores",
        "read"
      );
      const scope = scopeOf(store);
      const result = await withShopifyErrors(() => runStoreHealthCheck(scope));
      return {
        data: {
          error: result.ok ? null : result.error,
          ok: result.ok,
          store: toPublicStore(await getStore(scope)),
        },
      };
    }
  ),
  completeOAuth: os.shopifyStores.completeOAuth.handler(
    async ({ context, input }) => {
      const user = await requireUser(context.headers);
      const store = await withShopifyErrors(() =>
        completeOAuthConnection({
          actorId: user.id,
          canManage: ({ organizationId }) =>
            hasPermission({
              action: "manage",
              module: "stores",
              organizationId,
              userId: user.id,
            }),
          rawQuery: input.query,
          storeId: input.storeId,
        })
      );
      return { data: toPublicStore(store) };
    }
  ),
  connectClientCredentials: os.shopifyStores.connectClientCredentials.handler(
    async ({ context, input }) => {
      const { environment, ...connection } = input;
      const user = await requireManager(context.headers, input.organizationId);
      const results = await withShopifyErrors(() =>
        connectClientCredentialsStores({ ...connection, actorId: user.id })
      );
      return {
        data: await Promise.all(
          results.map(async (result) => ({
            error: result.ok ? null : result.error,
            ok: result.ok,
            shopDomain: result.shopDomain,
            store: result.ok
              ? toPublicStore(
                  await applyEnvironment(result.store, environment, user.id)
                )
              : null,
          }))
        ),
      };
    }
  ),
  connectStaticToken: os.shopifyStores.connectStaticToken.handler(
    async ({ context, input }) => {
      const { environment, ...connection } = input;
      const user = await requireManager(context.headers, input.organizationId);
      const store = await withShopifyErrors(() =>
        connectStaticTokenStore({ ...connection, actorId: user.id })
      );
      return {
        data: toPublicStore(
          await applyEnvironment(store, environment, user.id)
        ),
      };
    }
  ),
  disconnect: os.shopifyStores.disconnect.handler(
    async ({ context, input }) => {
      const { store, user } = await requireStorePermission(
        context.headers,
        input.storeId,
        "stores",
        "manage"
      );
      // Flows activated on the store are turned off first, while its
      // credentials can still remove their webhook subscriptions.
      await deactivateStoreActivations(
        store,
        { jobs: getJobProvider() },
        user.id
      );
      const disconnected = await withShopifyErrors(() =>
        disconnectStore(scopeOf(store), user.id)
      );
      return { data: toPublicStore(disconnected) };
    }
  ),
  get: os.shopifyStores.get.handler(async ({ context, input }) => {
    const { store } = await requireStorePermission(
      context.headers,
      input.storeId,
      "stores",
      "read"
    );
    return { data: toPublicStore(store) };
  }),
  list: os.shopifyStores.list.handler(async ({ context, input }) => {
    await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "stores",
      "read"
    );
    const stores = await listStores(input.organizationId);
    return { data: stores.map(toPublicStore) };
  }),
  setWebhookSecret: os.shopifyStores.setWebhookSecret.handler(
    async ({ context, input }) => {
      const { store } = await requireStorePermission(
        context.headers,
        input.storeId,
        "stores",
        "manage"
      );
      const scope = scopeOf(store);
      await updateStore(scope, {
        webhookSecretEncrypted: encryptSecret(input.secret),
      });
      return { data: toPublicStore(await getStore(scope)) };
    }
  ),
  update: os.shopifyStores.update.handler(async ({ context, input }) => {
    const { store, user } = await requireStorePermission(
      context.headers,
      input.storeId,
      "stores",
      "manage"
    );
    return {
      data: toPublicStore(
        await applyEnvironment(store, input.environment, user.id)
      ),
    };
  }),
  usage: os.shopifyStores.usage.handler(async ({ context, input }) => {
    const { store } = await requireStorePermission(
      context.headers,
      input.storeId,
      "stores",
      "read"
    );
    return { data: await countStoreUsage(scopeOf(store)) };
  }),
};
