// The parser only: the package's main graphql entry also loads the database.
import {
  classifyOperation,
  GraphqlDocumentError,
} from "@repo/shopify/graphql/classify-operation";
import { MAIN_OUTPUT } from "../definition/node-spec";
import { shopifyGraphqlSpec } from "../definition/specs/shopify-graphql";
import {
  defineNode,
  FlowFatalError,
  type FlowItem,
  FlowItemError,
  type NodeContext,
} from "../registry/define-node";

const USER_ERRORS_KEY = /(^u|U)serErrors$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Fills templates in every text value of the variables, at any depth. */
const resolveDeep = (
  value: unknown,
  ctx: NodeContext,
  item: FlowItem
): unknown => {
  if (typeof value === "string") {
    return ctx.resolve(value, item);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveDeep(entry, ctx, item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveDeep(entry, ctx, item),
      ])
    );
  }
  return value;
};

const describeUserError = (error: unknown): string[] => {
  if (!(isRecord(error) && typeof error.message === "string")) {
    return [];
  }
  const field = Array.isArray(error.field) ? error.field.join(".") : "";
  return [field ? `${field}: ${error.message}` : error.message];
};

/** Messages of the `userErrors` a mutation payload reported. */
const collectUserErrors = (data: unknown): string[] =>
  Object.values(isRecord(data) ? data : {})
    .filter(isRecord)
    .flatMap((payload) => Object.entries(payload))
    .filter(
      ([key, errors]) => USER_ERRORS_KEY.test(key) && Array.isArray(errors)
    )
    .flatMap(([, errors]) => (errors as unknown[]).flatMap(describeUserError));

const readPath = (data: unknown, path: string): unknown => {
  let current = data;
  for (const segment of path.split(".").filter(Boolean)) {
    if (!(isRecord(current) && Object.hasOwn(current, segment))) {
      return null;
    }
    current = current[segment];
  }
  return current ?? null;
};

/**
 * Runs one query or mutation per item. Subscriptions and documents with
 * several operations are refused before anything is sent.
 */
export const shopifyGraphqlNode = defineNode(
  shopifyGraphqlSpec,
  async ({ config, ctx, item }) => {
    try {
      const { type } = classifyOperation(config.document);
      if (type === "subscription") {
        throw new FlowFatalError("Subscriptions cannot run in a flow.");
      }
    } catch (error) {
      if (error instanceof GraphqlDocumentError) {
        throw new FlowFatalError(
          `The GraphQL document cannot be run: ${error.message}`
        );
      }
      throw error;
    }

    const variables = resolveDeep(JSON.parse(config.variables), ctx, item);
    const data = await ctx.shopify.request(
      config.document,
      variables as Record<string, unknown>
    );
    const userErrors = collectUserErrors(data);
    if (userErrors.length > 0) {
      throw new FlowItemError(userErrors.join("; "));
    }
    return {
      outputs: [
        {
          handle: MAIN_OUTPUT,
          json: { ...item.json, result: readPath(data, config.resultPath) },
        },
      ],
    };
  }
);
