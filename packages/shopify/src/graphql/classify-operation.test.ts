import { describe, expect, it } from "vitest";
import { classifyOperation, GraphqlDocumentError } from "./classify-operation";

const problemOf = (document: string, operationName?: string) => {
  try {
    classifyOperation(document, operationName);
  } catch (error) {
    return error instanceof GraphqlDocumentError ? error.problem : error;
  }
};

describe("classifyOperation", () => {
  it("classifies queries, including the shorthand form", () => {
    expect(classifyOperation("{ shop { name } }")).toEqual({
      operationName: undefined,
      type: "query",
    });
    expect(classifyOperation("query Shop { shop { name } }")).toEqual({
      operationName: "Shop",
      type: "query",
    });
  });

  it("classifies mutations and subscriptions", () => {
    expect(
      classifyOperation(
        "mutation Tag($id: ID!) { tagsAdd(id: $id, tags: []) { node { id } } }"
      ).type
    ).toBe("mutation");
    expect(classifyOperation("subscription { orderCreated { id } }").type).toBe(
      "subscription"
    );
  });

  it("is not fooled by a mutation hidden behind comments, strings or names", () => {
    expect(
      classifyOperation('# query\nmutation query { a(note: "query { x }") }')
        .type
    ).toBe("mutation");
    expect(classifyOperation("query mutation { shop { name } }").type).toBe(
      "query"
    );
  });

  it("selects by operation name when the document has several operations", () => {
    const document =
      "query Read { shop { name } } mutation Write { tagsAdd { node { id } } }";

    expect(classifyOperation(document, "Read").type).toBe("query");
    expect(classifyOperation(document, "Write").type).toBe("mutation");
    expect(problemOf(document)).toBe("AMBIGUOUS_OPERATION");
    expect(problemOf(document, "Missing")).toBe("UNKNOWN_OPERATION");
  });

  it("reports parse errors and documents without an operation", () => {
    expect(problemOf("query {")).toBe("PARSE_ERROR");
    expect(problemOf("")).toBe("PARSE_ERROR");
    expect(problemOf("fragment F on Shop { name }")).toBe("NO_OPERATION");
  });

  it("flags introspection only when every root field is a meta field", () => {
    expect(
      classifyOperation(
        "query IntrospectionQuery { __schema { types { name } } }"
      ).type
    ).toBe("introspection");
    expect(classifyOperation('{ __type(name: "Shop") { name } }').type).toBe(
      "introspection"
    );
    expect(
      classifyOperation("{ __schema { types { name } } shop { name } }").type
    ).toBe("query");
    expect(
      classifyOperation(
        "query { ...F } fragment F on QueryRoot { __schema { types { name } } }"
      ).type
    ).toBe("query");
    expect(classifyOperation("mutation { __typename }").type).toBe("mutation");
  });
});
