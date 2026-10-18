import { z } from "zod";
import { apiContract, dataEnvelope } from "./base";
import {
  organizationIdInput,
  shopDomainSchema,
  storeIdInput,
  targetEnvironmentSchema,
} from "./shopify-shared";

export const MAX_STORES_PER_CONNECT_REQUEST = 10;

export const shopifyCredentialStrategySchema = z.enum([
  "STATIC_TOKEN",
  "OAUTH",
  "CLIENT_CREDENTIALS",
]);

export const shopifyStoreStatusSchema = z.enum([
  "PENDING",
  "CONNECTED",
  "RECONNECT_REQUIRED",
  "DISCONNECTED",
]);

/**
 * Fields are listed explicitly; no token or secret is ever part of a store.
 * Secrets are only returned one at a time by `revealSecret`.
 */
export const shopifyStoreSchema = z.object({
  apiVersion: z.string(),
  appId: z.string().nullable(),
  connectedAt: z.date().nullable(),
  createdAt: z.date(),
  currencyCode: z.string().nullable(),
  environment: targetEnvironmentSchema,
  /** Whether a webhook signing secret is saved; the secret is never returned. */
  hasWebhookSecret: z.boolean(),
  id: z.string(),
  lastHealthCheckAt: z.date().nullable(),
  lastHealthCheckError: z.string().nullable(),
  name: z.string(),
  /** True when a person renamed the store; health checks then keep the name. */
  nameCustomized: z.boolean(),
  organizationId: z.string(),
  scopes: z.array(z.string()),
  shopDomain: z.string(),
  status: shopifyStoreStatusSchema,
  strategy: shopifyCredentialStrategySchema,
  updatedAt: z.date(),
});

/** Secrets a store manager can copy; each copy is audited. */
export const shopifyStoreSecretSchema = z.enum([
  "accessToken",
  "webhookSecret",
]);

const appId = z.string().min(1);
/** Set on connect; when omitted a new store is DEV and a reconnect keeps its value. */
const environmentInput = { environment: targetEnvironmentSchema.optional() };

export const shopifyStoresContract = {
  beginOAuth: apiContract
    .route({
      method: "POST",
      operationId: "shopifyStores.beginOAuth",
      path: "/api/organizations/{organizationId}/shopify/stores/oauth",
      successStatus: 201,
      summary: "Start an OAuth install for a store",
    })
    .input(
      organizationIdInput.extend({
        appId,
        shopDomain: shopDomainSchema,
        ...environmentInput,
      })
    )
    .output(
      dataEnvelope(
        z.object({
          authorizeUrl: z.url(),
          installLink: z.string().nullable(),
          redirectUrl: z.url(),
          store: shopifyStoreSchema,
        })
      )
    ),
  checkHealth: apiContract
    .route({
      method: "POST",
      operationId: "shopifyStores.checkHealth",
      path: "/api/shopify/stores/{storeId}/health-check",
      summary: "Check that a store's credentials still work",
    })
    .input(storeIdInput)
    .output(
      dataEnvelope(
        z.object({
          error: z.string().nullable(),
          ok: z.boolean(),
          store: shopifyStoreSchema,
        })
      )
    ),
  completeOAuth: apiContract
    .route({
      method: "POST",
      operationId: "shopifyStores.completeOAuth",
      path: "/api/shopify/oauth/complete",
      summary: "Finish an OAuth install from the callback query",
    })
    .input(
      z.object({
        query: z.string().min(1).max(8192),
        storeId: z.string().min(1).optional(),
      })
    )
    .output(dataEnvelope(shopifyStoreSchema)),
  connectClientCredentials: apiContract
    .route({
      method: "POST",
      operationId: "shopifyStores.connectClientCredentials",
      path: "/api/organizations/{organizationId}/shopify/stores/client-credentials",
      summary: "Connect stores that share a Shopify organization with an app",
    })
    .input(
      organizationIdInput.extend({
        appId,
        ...environmentInput,
        shopDomains: z
          .array(shopDomainSchema)
          .min(1)
          .max(MAX_STORES_PER_CONNECT_REQUEST),
      })
    )
    .output(
      dataEnvelope(
        z.array(
          z.object({
            error: z.string().nullable(),
            ok: z.boolean(),
            shopDomain: z.string(),
            store: shopifyStoreSchema.nullable(),
          })
        )
      )
    ),
  connectStaticToken: apiContract
    .route({
      method: "POST",
      operationId: "shopifyStores.connectStaticToken",
      path: "/api/organizations/{organizationId}/shopify/stores/static-token",
      successStatus: 201,
      summary: "Connect a store with a pasted Admin API token",
    })
    .input(
      organizationIdInput.extend({
        accessToken: z.string().trim().min(8).max(512),
        ...environmentInput,
        shopDomain: shopDomainSchema,
      })
    )
    .output(dataEnvelope(shopifyStoreSchema)),
  disconnect: apiContract
    .route({
      method: "DELETE",
      operationId: "shopifyStores.disconnect",
      path: "/api/shopify/stores/{storeId}",
      summary: "Remove a store's credentials and mark it disconnected",
    })
    .input(storeIdInput)
    .output(dataEnvelope(shopifyStoreSchema)),
  get: apiContract
    .route({
      method: "GET",
      operationId: "shopifyStores.get",
      path: "/api/shopify/stores/{storeId}",
      summary: "Get a store",
    })
    .input(storeIdInput)
    .output(dataEnvelope(shopifyStoreSchema)),
  list: apiContract
    .route({
      method: "GET",
      operationId: "shopifyStores.list",
      path: "/api/organizations/{organizationId}/shopify/stores",
      summary: "List an organization's stores",
    })
    .input(organizationIdInput)
    .output(dataEnvelope(z.array(shopifyStoreSchema))),
  revealSecret: apiContract
    .route({
      method: "POST",
      operationId: "shopifyStores.revealSecret",
      path: "/api/shopify/stores/{storeId}/secrets/reveal",
      summary:
        "Return a store's access token or webhook secret so it can be copied",
    })
    .input(storeIdInput.extend({ secret: shopifyStoreSecretSchema }))
    .output(dataEnvelope(z.object({ value: z.string() }))),

  setWebhookSecret: apiContract
    .route({
      method: "PUT",
      operationId: "shopifyStores.setWebhookSecret",
      path: "/api/shopify/stores/{storeId}/webhook-secret",
      summary: "Save the secret that signs a store's webhooks",
    })
    .input(storeIdInput.extend({ secret: z.string().trim().min(8).max(512) }))
    .output(dataEnvelope(shopifyStoreSchema)),

  update: apiContract
    .route({
      method: "PATCH",
      operationId: "shopifyStores.update",
      path: "/api/shopify/stores/{storeId}",
      summary: "Rename a store or change its environment",
    })
    .input(
      storeIdInput.extend({
        environment: targetEnvironmentSchema.optional(),
        /** `null` goes back to the name Shopify reports. */
        name: z.string().trim().min(1).max(120).nullable().optional(),
      })
    )
    .output(dataEnvelope(shopifyStoreSchema)),
  updateCredentials: apiContract
    .route({
      method: "PUT",
      operationId: "shopifyStores.updateCredentials",
      path: "/api/shopify/stores/{storeId}/credentials",
      summary:
        "Change the domain or access token of a store connected by token",
    })
    .input(
      storeIdInput.extend({
        accessToken: z.string().trim().min(8).max(512).optional(),
        shopDomain: shopDomainSchema.optional(),
      })
    )
    .output(dataEnvelope(shopifyStoreSchema)),
  usage: apiContract
    .route({
      method: "GET",
      operationId: "shopifyStores.usage",
      path: "/api/shopify/stores/{storeId}/usage",
      summary: "Count the flows, runs and activations that use a store",
    })
    .input(storeIdInput)
    .output(
      dataEnvelope(
        z.object({
          activationCount: z.number().int(),
          flowCount: z.number().int(),
          runCount: z.number().int(),
        })
      )
    ),
};
