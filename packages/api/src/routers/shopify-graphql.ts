import { hasPermission } from "@repo/auth/permissions";
import {
  executeGraphqlForUser,
  GraphqlDocumentError,
  GraphqlMutationForbiddenError,
  listStoreApiVersions,
  ShopifyGraphqlError,
  ShopifyTransportError,
} from "@repo/shopify";
import { StoreReconnectRequiredError } from "@repo/shopify/stores";
import { ApiError } from "../errors";
import { requireStorePermission } from "./authz";
import { os } from "./implementer";

/** Maps failures of a forwarded console request to API errors. */
const withGraphqlErrors = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GraphqlDocumentError) {
      throw new ApiError("VALIDATION_ERROR", error.message, 422, {
        reason: error.problem,
      });
    }
    if (error instanceof GraphqlMutationForbiddenError) {
      throw new ApiError("FORBIDDEN", error.message, 403);
    }
    if (error instanceof StoreReconnectRequiredError) {
      throw new ApiError(
        "CONFLICT",
        "This store needs to be reconnected before it can be queried.",
        409
      );
    }
    if (
      error instanceof ShopifyTransportError ||
      error instanceof ShopifyGraphqlError
    ) {
      throw new ApiError("SERVICE_UNAVAILABLE", error.message, 503);
    }
    throw error;
  }
};

export const shopifyGraphqlRouter = {
  execute: os.shopifyGraphql.execute.handler(async ({ context, input }) => {
    const { store, user } = await requireStorePermission(
      context.headers,
      input.storeId,
      "graphql",
      "query"
    );
    const result = await withGraphqlErrors(() =>
      executeGraphqlForUser({
        actorId: user.id,
        apiVersion: input.apiVersion,
        canMutate: () =>
          hasPermission({
            action: "mutate",
            module: "graphql",
            organizationId: store.organizationId,
            userId: user.id,
          }),
        costDebug: input.costDebug,
        operationName: input.operationName ?? undefined,
        query: input.query,
        scope: { organizationId: store.organizationId, storeId: store.id },
        variables: input.variables ?? undefined,
      })
    );
    return { data: result };
  }),
  versions: os.shopifyGraphql.versions.handler(async ({ context, input }) => {
    const { store } = await requireStorePermission(
      context.headers,
      input.storeId,
      "graphql",
      "query"
    );
    return {
      data: await withGraphqlErrors(() =>
        listStoreApiVersions({
          organizationId: store.organizationId,
          storeId: store.id,
        })
      ),
    };
  }),
};
