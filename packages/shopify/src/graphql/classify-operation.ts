import { Kind, type OperationDefinitionNode, parse } from "graphql";

export type GraphqlOperationType =
  | "query"
  | "mutation"
  | "subscription"
  | "introspection";

export type GraphqlDocumentProblem =
  | "PARSE_ERROR"
  | "NO_OPERATION"
  | "AMBIGUOUS_OPERATION"
  | "UNKNOWN_OPERATION";

export class GraphqlDocumentError extends Error {
  readonly problem: GraphqlDocumentProblem;

  constructor(problem: GraphqlDocumentProblem, message: string) {
    super(message);
    this.name = "GraphqlDocumentError";
    this.problem = problem;
  }
}

export interface ClassifiedOperation {
  operationName: string | undefined;
  type: GraphqlOperationType;
}

/**
 * A query counts as introspection only when every root selection is a
 * double-underscore field. Fragments at the root are treated as ordinary
 * queries so they can never slip past a permission meant for data access.
 */
const isIntrospection = (operation: OperationDefinitionNode): boolean =>
  operation.selectionSet.selections.length > 0 &&
  operation.selectionSet.selections.every(
    (selection) =>
      selection.kind === Kind.FIELD && selection.name.value.startsWith("__")
  );

const selectOperation = (
  operations: OperationDefinitionNode[],
  operationName: string | undefined
): OperationDefinitionNode => {
  if (operationName) {
    const named = operations.find(
      (operation) => operation.name?.value === operationName
    );
    if (!named) {
      throw new GraphqlDocumentError(
        "UNKNOWN_OPERATION",
        `The document has no operation named "${operationName}".`
      );
    }
    return named;
  }
  const [first, ...others] = operations;
  if (!first) {
    throw new GraphqlDocumentError(
      "NO_OPERATION",
      "The document contains no operation."
    );
  }
  if (others.length > 0) {
    throw new GraphqlDocumentError(
      "AMBIGUOUS_OPERATION",
      "The document contains several operations; an operation name is required."
    );
  }
  return first;
};

/** Determines which operation a request will run, without executing it. */
export const classifyOperation = (
  document: string,
  operationName?: string | null
): ClassifiedOperation => {
  let operations: OperationDefinitionNode[];
  try {
    operations = parse(document).definitions.filter(
      (definition): definition is OperationDefinitionNode =>
        definition.kind === Kind.OPERATION_DEFINITION
    );
  } catch (error) {
    throw new GraphqlDocumentError(
      "PARSE_ERROR",
      error instanceof Error
        ? error.message
        : "The document is not valid GraphQL."
    );
  }

  const operation = selectOperation(operations, operationName ?? undefined);
  const type =
    operation.operation === "query" && isIntrospection(operation)
      ? "introspection"
      : operation.operation;
  return { operationName: operation.name?.value, type };
};
