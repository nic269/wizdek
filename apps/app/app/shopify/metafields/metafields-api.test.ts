import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/api/client", () => ({ apiClient: {} }));

import {
  checkMutation,
  type Draft,
  readResponse,
  validateDrafts,
} from "./metafields-api";

const draft: Draft = {
  description: "",
  id: "1",
  key: "care",
  name: "Care instructions",
  namespace: "custom",
  type: "multi_line_text_field",
};

describe("metafield batch validation", () => {
  it("rejects duplicate identifiers before any writes", () => {
    expect(validateDrafts([draft, { ...draft, id: "2" }])).toContain(
      "Duplicate"
    );
  });
  it("rejects blank names and malformed namespace/key", () => {
    expect(validateDrafts([{ ...draft, name: " " }])).toContain("name");
    expect(validateDrafts([{ ...draft, namespace: "a.b" }])).toContain(
      "Namespaces"
    );
    expect(validateDrafts([{ ...draft, key: "x" }])).toContain("Keys");
  });
  it("validates remaining rows without resubmitting successful rows", () => {
    expect(
      validateDrafts([
        { ...draft, created: true },
        { ...draft, id: "2", key: "care_label" },
      ])
    ).toBeNull();
  });
});

describe("Shopify response handling", () => {
  it("rejects top-level errors even alongside partial data", () => {
    expect(() =>
      readResponse({ data: {}, errors: [{ message: "Access denied" }] }, 200)
    ).toThrow("Access denied");
  });
  it("rejects transport failures and missing data", () => {
    expect(() => readResponse({}, 429)).toThrow("429");
    expect(() => readResponse(null, 200)).toThrow();
  });
  it("does not mistake mutation userErrors or null payloads for success", () => {
    expect(() =>
      checkMutation({
        createdDefinition: null,
        userErrors: [{ message: "Already exists" }],
      })
    ).toThrow("Already exists");
    expect(() => checkMutation(null)).toThrow();
    expect(() => checkMutation({ userErrors: [] })).toThrow();
  });
  it("requires Shopify confirmation for create, update and delete", () => {
    expect(() =>
      checkMutation({ createdDefinition: { id: "1" }, userErrors: [] })
    ).not.toThrow();
    expect(() =>
      checkMutation({ updatedDefinition: { id: "1" }, userErrors: [] })
    ).not.toThrow();
    expect(() =>
      checkMutation({ deletedDefinitionId: "1", userErrors: [] })
    ).not.toThrow();
  });
});
