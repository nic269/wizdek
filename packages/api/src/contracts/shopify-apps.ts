import { z } from "zod";
import { apiContract, dataEnvelope } from "./base";
import { organizationIdInput } from "./shopify-shared";

export const shopifyTokenModeSchema = z.enum(["NON_EXPIRING", "EXPIRING"]);

/** The client secret is write-only: responses say only that one is stored. */
export const shopifyAppSchema = z.object({
  clientId: z.string(),
  createdAt: z.date(),
  hasClientSecret: z.literal(true),
  id: z.string(),
  installLink: z.string().nullable(),
  name: z.string(),
  organizationId: z.string(),
  scopes: z.array(z.string()),
  storeCount: z.number().int().nonnegative(),
  tokenMode: shopifyTokenModeSchema,
  updatedAt: z.date(),
});

const scopeSchema = z
  .string()
  .trim()
  .regex(/^[a-z_]+$/, "Scopes look like read_orders.");
const scopesSchema = z.array(scopeSchema).max(100);
const nameSchema = z.string().trim().min(2).max(80);
const clientSecretSchema = z.string().trim().min(8).max(512);
const installLinkSchema = z.url({ protocol: /^https$/ }).max(2048);
const appIdInput = organizationIdInput.extend({ appId: z.string().min(1) });

export const shopifyAppsContract = {
  create: apiContract
    .route({
      method: "POST",
      operationId: "shopifyApps.create",
      path: "/api/organizations/{organizationId}/shopify/apps",
      successStatus: 201,
      summary: "Register a Shopify app",
    })
    .input(
      organizationIdInput.extend({
        clientId: z.string().trim().min(8).max(128),
        clientSecret: clientSecretSchema,
        installLink: installLinkSchema.optional(),
        name: nameSchema,
        scopes: scopesSchema.default([]),
        tokenMode: shopifyTokenModeSchema.default("NON_EXPIRING"),
      })
    )
    .output(dataEnvelope(shopifyAppSchema)),
  delete: apiContract
    .route({
      method: "DELETE",
      operationId: "shopifyApps.delete",
      path: "/api/organizations/{organizationId}/shopify/apps/{appId}",
      successStatus: 204,
      summary: "Delete a Shopify app that no store uses",
    })
    .input(appIdInput)
    .output(z.void()),
  list: apiContract
    .route({
      method: "GET",
      operationId: "shopifyApps.list",
      path: "/api/organizations/{organizationId}/shopify/apps",
      summary: "List registered Shopify apps",
    })
    .input(organizationIdInput)
    .output(dataEnvelope(z.array(shopifyAppSchema))),
  update: apiContract
    .route({
      method: "PATCH",
      operationId: "shopifyApps.update",
      path: "/api/organizations/{organizationId}/shopify/apps/{appId}",
      summary:
        "Rename a Shopify app, rotate its secret or change its token mode",
    })
    .input(
      appIdInput.extend({
        clientSecret: clientSecretSchema.optional(),
        installLink: installLinkSchema.nullable().optional(),
        name: nameSchema.optional(),
        scopes: scopesSchema.optional(),
        tokenMode: shopifyTokenModeSchema.optional(),
      })
    )
    .output(dataEnvelope(shopifyAppSchema)),
};
