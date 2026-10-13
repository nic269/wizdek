import { z } from "zod";
import { apiContract, dataEnvelope } from "./base";
import { storeIdInput } from "./shopify-shared";

export const MAX_GRAPHQL_DOCUMENT_LENGTH = 500_000;
export const MAX_GRAPHQL_VARIABLES_LENGTH = 1_000_000;

export const apiVersionSchema = z
  .string()
  .regex(/^(\d{4}-\d{2}|unstable)$/, "Use a version like 2026-07.");

const variablesSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (variables) =>
      JSON.stringify(variables).length <= MAX_GRAPHQL_VARIABLES_LENGTH,
    "Variables are limited to 1 MB."
  );

const throttleStatusSchema = z.object({
  currentlyAvailable: z.number(),
  maximumAvailable: z.number(),
  restoreRate: z.number(),
});

export const queryCostSchema = z.object({
  actualQueryCost: z.number().optional(),
  fields: z.array(z.unknown()).optional(),
  requestedQueryCost: z.number().optional(),
  throttleStatus: throttleStatusSchema.optional(),
});

export const shopifyGraphqlContract = {
  execute: apiContract
    .route({
      method: "POST",
      operationId: "shopifyGraphql.execute",
      path: "/api/shopify/stores/{storeId}/graphql",
      summary: "Run an Admin GraphQL document against a connected store",
    })
    .input(
      storeIdInput.extend({
        apiVersion: apiVersionSchema.optional(),
        costDebug: z.boolean().optional(),
        operationName: z.string().min(1).max(256).nullish(),
        query: z.string().min(1).max(MAX_GRAPHQL_DOCUMENT_LENGTH),
        variables: variablesSchema.nullish(),
      })
    )
    .output(
      dataEnvelope(
        z.object({
          /** Shopify's response body, passed through untouched. */
          body: z.unknown(),
          cost: queryCostSchema.nullable(),
          httpStatus: z.number().int(),
          shopifyRequestId: z.string().nullable(),
        })
      )
    ),
  versions: apiContract
    .route({
      method: "GET",
      operationId: "shopifyGraphql.versions",
      path: "/api/shopify/stores/{storeId}/api-versions",
      summary: "List the Admin API versions a store offers",
    })
    .input(storeIdInput)
    .output(
      dataEnvelope(
        z.object({
          current: z.string(),
          versions: z.array(
            z.object({
              displayName: z.string(),
              handle: z.string(),
              supported: z.boolean(),
            })
          ),
        })
      )
    ),
};
