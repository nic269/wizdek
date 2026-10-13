import { z } from "zod";
import { apiContract, dataEnvelope } from "./base";
import { MAX_GRAPHQL_DOCUMENT_LENGTH } from "./shopify-graphql";
import { organizationIdInput } from "./shopify-shared";

export const savedQuerySchema = z.object({
  createdAt: z.date(),
  createdById: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  organizationId: z.string(),
  query: z.string(),
  updatedAt: z.date(),
  variables: z.string().nullable(),
});

const nameSchema = z.string().trim().min(1).max(120);
const querySchema = z.string().min(1).max(MAX_GRAPHQL_DOCUMENT_LENGTH);
const variablesSchema = z.string().max(100_000);
const savedQueryIdInput = organizationIdInput.extend({
  savedQueryId: z.string().min(1),
});

export const savedQueriesContract = {
  create: apiContract
    .route({
      method: "POST",
      operationId: "savedQueries.create",
      path: "/api/organizations/{organizationId}/graphql/saved-queries",
      successStatus: 201,
      summary: "Save a GraphQL query for the organization",
    })
    .input(
      organizationIdInput.extend({
        name: nameSchema,
        query: querySchema,
        variables: variablesSchema.optional(),
      })
    )
    .output(dataEnvelope(savedQuerySchema)),
  delete: apiContract
    .route({
      method: "DELETE",
      operationId: "savedQueries.delete",
      path: "/api/organizations/{organizationId}/graphql/saved-queries/{savedQueryId}",
      successStatus: 204,
      summary: "Delete a saved GraphQL query",
    })
    .input(savedQueryIdInput)
    .output(z.void()),
  list: apiContract
    .route({
      method: "GET",
      operationId: "savedQueries.list",
      path: "/api/organizations/{organizationId}/graphql/saved-queries",
      summary: "List the organization's saved GraphQL queries",
    })
    .input(organizationIdInput)
    .output(dataEnvelope(z.array(savedQuerySchema))),
  update: apiContract
    .route({
      method: "PATCH",
      operationId: "savedQueries.update",
      path: "/api/organizations/{organizationId}/graphql/saved-queries/{savedQueryId}",
      summary: "Rename a saved GraphQL query or replace its contents",
    })
    .input(
      savedQueryIdInput.extend({
        name: nameSchema.optional(),
        query: querySchema.optional(),
        variables: variablesSchema.nullable().optional(),
      })
    )
    .output(dataEnvelope(savedQuerySchema)),
};
