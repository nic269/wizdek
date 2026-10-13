import { createHash } from "node:crypto";
import { type Prisma, prisma } from "@repo/database";
import type { ShopifyQueryCost } from "../admin/cost";
import { ShopifyTransportError } from "../admin/errors";
import { recordShopifyAudit } from "../stores/audit";
import {
  createStoreClient,
  type StoreClientOptions,
} from "../stores/store-client";
import type { StoreScope } from "../stores/store-repository";
import {
  type ClassifiedOperation,
  classifyOperation,
  GraphqlDocumentError,
} from "./classify-operation";
import { countGraphqlErrors, countUserErrors } from "./user-errors";

/**
 * Kept below the 30-second timeout of the proxy that carries browser calls to
 * the API, so the caller gets an answer before that proxy gives up.
 */
export const CONSOLE_EXECUTE_TIMEOUT_MS = 25_000;

export const SUPPORTED_API_VERSIONS_QUERY =
  "query ApiVersions { publicApiVersions { handle displayName supported } }";

export interface GraphqlExecutionInput {
  actorId: string;
  apiVersion?: string | undefined;
  /** Asked only when the document turns out to be a mutation. */
  canMutate: () => Promise<boolean>;
  costDebug?: boolean | undefined;
  operationName?: string | undefined;
  query: string;
  scope: StoreScope;
  variables?: Record<string, unknown> | undefined;
}

export interface GraphqlExecutionResult {
  /** Shopify's JSON, untouched. */
  body: unknown;
  cost: ShopifyQueryCost | null;
  /** Shopify's HTTP status, or 400 when the document was never forwarded. */
  httpStatus: number;
  shopifyRequestId: string | null;
}

/** The caller may run queries on this store but not mutations. */
export class GraphqlMutationForbiddenError extends Error {
  constructor() {
    super("You do not have permission to run mutations on this store.");
    this.name = "GraphqlMutationForbiddenError";
  }
}

const classify = (
  query: string,
  operationName: string | undefined
): ClassifiedOperation | GraphqlExecutionResult => {
  try {
    return classifyOperation(query, operationName);
  } catch (error) {
    if (
      error instanceof GraphqlDocumentError &&
      error.problem === "PARSE_ERROR"
    ) {
      // Answered like a GraphQL server would, so the editor shows it inline.
      return {
        body: { errors: [{ message: error.message }] },
        cost: null,
        httpStatus: 400,
        shopifyRequestId: null,
      };
    }
    throw error;
  }
};

/**
 * Runs a console request on behalf of a user: decides the permission from the
 * parsed document, forwards it with the store's own token, and audits it.
 * Nothing is forwarded when the document is rejected or permission fails.
 */
export const executeGraphqlForUser = async (
  input: GraphqlExecutionInput,
  options: StoreClientOptions = {}
): Promise<GraphqlExecutionResult> => {
  const classified = classify(input.query, input.operationName);
  if ("body" in classified) {
    return classified;
  }
  if (classified.type === "subscription") {
    throw new GraphqlDocumentError(
      "UNSUPPORTED_OPERATION",
      "Subscriptions are not supported by the Admin API console."
    );
  }
  if (classified.type === "mutation" && !(await input.canMutate())) {
    throw new GraphqlMutationForbiddenError();
  }

  const client = await createStoreClient(input.scope, options);
  const apiVersion = input.apiVersion ?? client.store.apiVersion;
  const startedAt = Date.now();
  const audit = (outcome: Prisma.InputJsonObject) => {
    if (classified.type === "introspection") {
      return;
    }
    return recordShopifyAudit(prisma, {
      action:
        classified.type === "mutation"
          ? "shopify.graphql.mutation"
          : "shopify.graphql.query",
      actorId: input.actorId,
      metadata: {
        apiVersion,
        document: input.query,
        documentSha256: createHash("sha256").update(input.query).digest("hex"),
        durationMs: Date.now() - startedAt,
        operationName: classified.operationName ?? null,
        operationType: classified.type,
        shopDomain: client.store.shopDomain,
        variables: (input.variables ?? null) as Prisma.InputJsonValue | null,
        ...outcome,
      },
      organizationId: client.store.organizationId,
      targetId: client.store.id,
      targetType: "ShopifyStore",
    });
  };

  try {
    const result = await client.request({
      apiVersion,
      costDebug: input.costDebug,
      operationName: input.operationName,
      query: input.query,
      timeoutMs: CONSOLE_EXECUTE_TIMEOUT_MS,
      variables: input.variables,
    });
    await audit({
      actualQueryCost: result.cost?.actualQueryCost ?? null,
      graphqlErrorCount: countGraphqlErrors(result.body),
      httpStatus: result.httpStatus,
      requestedQueryCost: result.cost?.requestedQueryCost ?? null,
      shopifyRequestId: result.requestId ?? null,
      userErrorCount: countUserErrors(result.body),
    });
    return {
      body: result.body,
      cost: result.cost ?? null,
      httpStatus: result.httpStatus,
      shopifyRequestId: result.requestId ?? null,
    };
  } catch (error) {
    if (error instanceof ShopifyTransportError) {
      // The request may still have reached Shopify, so the attempt is kept.
      await audit({
        httpStatus: error.httpStatus ?? null,
        shopifyRequestId: error.requestId ?? null,
        transportFailure: error.failure,
      });
    }
    throw error;
  }
};

export interface ShopifyApiVersion {
  displayName: string;
  handle: string;
  supported: boolean;
}

/** Lists the Admin API versions the store currently offers. */
export const listStoreApiVersions = async (
  scope: StoreScope,
  options: StoreClientOptions = {}
): Promise<{ current: string; versions: ShopifyApiVersion[] }> => {
  const client = await createStoreClient(scope, options);
  const data = await client.requestOrThrow<{
    publicApiVersions: ShopifyApiVersion[];
  }>({
    operationName: "ApiVersions",
    query: SUPPORTED_API_VERSIONS_QUERY,
    timeoutMs: CONSOLE_EXECUTE_TIMEOUT_MS,
  });
  return { current: client.store.apiVersion, versions: data.publicApiVersions };
};
