import { Kind, parse } from "graphql";

export type OperationKind = "query" | "mutation" | "subscription";

export interface Operation {
  kind: OperationKind;
  name: string | null;
}

/**
 * Which operation a document will run: the named one, or the only one. The
 * server decides for itself; this only colours the Run button and asks
 * before a production mutation. Unparsable text reads as a query.
 */
export const operationOf = (
  query: string,
  operationName?: string | null
): Operation => {
  try {
    const operations = parse(query).definitions.filter(
      (definition) => definition.kind === Kind.OPERATION_DEFINITION
    );
    const chosen = operationName
      ? operations.find((operation) => operation.name?.value === operationName)
      : operations[0];
    return {
      kind: chosen?.operation ?? "query",
      name: chosen?.name?.value ?? operationName ?? null,
    };
  } catch {
    return { kind: "query", name: operationName ?? null };
  }
};
