import { apiClient, getApiErrorMessage } from "@repo/api/client";
import type { GraphiQLProps } from "graphiql";
import { useEffect, useMemo, useRef } from "react";
import { operationOf } from "./operation-kind";

type Fetcher = GraphiQLProps["fetcher"];

export type ExecutionResult = Awaited<
  ReturnType<typeof apiClient.shopifyGraphql.execute>
>["data"];

type Outcome =
  | { kind: "response"; result: ExecutionResult }
  | { kind: "refused"; message: string };

export type ExecutionOutcome = Outcome & { durationMs: number };

const INTROSPECTION_OPERATION = "IntrospectionQuery";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Builds the GraphiQL fetcher for one store and API version. Requests go to
 * the API proxy, which holds the store token; the fetcher returns Shopify's
 * body as-is. Its identity changes only with the store or version, which is
 * what makes GraphiQL reload the schema.
 */
export const useConsoleFetcher = ({
  apiVersion,
  confirmMutation,
  costDebug,
  onOutcome,
  storeId,
}: {
  apiVersion: string | undefined;
  /** Asked before a mutation is sent; resolving false cancels it. */
  confirmMutation: (operationName: string | null) => Promise<boolean>;
  costDebug: boolean;
  onOutcome: (outcome: ExecutionOutcome) => void;
  storeId: string;
}): Fetcher => {
  // Read at call time so toggling cost or replacing the callbacks does not
  // rebuild the fetcher and trigger a schema reload.
  const latest = useRef({ confirmMutation, costDebug, onOutcome });
  useEffect(() => {
    latest.current = { confirmMutation, costDebug, onOutcome };
  }, [confirmMutation, costDebug, onOutcome]);

  return useMemo<Fetcher>(
    () => async (params) => {
      const isIntrospection = params.operationName === INTROSPECTION_OPERATION;
      const startedAt = performance.now();
      const report = (outcome: Outcome) => {
        if (!isIntrospection) {
          latest.current.onOutcome({
            ...outcome,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }
      };
      const operation = operationOf(params.query, params.operationName);
      if (
        operation.kind === "mutation" &&
        !(await latest.current.confirmMutation(operation.name))
      ) {
        const message = "Canceled. The mutation was not sent.";
        report({ kind: "refused", message });
        return { errors: [{ message }] };
      }
      try {
        const { data } = await apiClient.shopifyGraphql.execute({
          ...(apiVersion ? { apiVersion } : {}),
          costDebug: !isIntrospection && latest.current.costDebug,
          operationName: params.operationName ?? null,
          query: params.query,
          storeId,
          variables: isRecord(params.variables) ? params.variables : null,
        });
        report({ kind: "response", result: data });
        return data.body as Record<string, unknown>;
      } catch (cause) {
        const message = getApiErrorMessage(
          cause,
          "The request could not be sent."
        );
        report({ kind: "refused", message });
        return { errors: [{ message }] };
      }
    },
    [apiVersion, storeId]
  );
};
