import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/api/client", () => ({ apiClient: {} }));

import {
  buildCopyInput,
  type CopyDefinition,
  defaultMappings,
  referenceKeys,
} from "./copy-api";
import { type Draft, validateDrafts } from "./metafields-api";
import { referenceValidations } from "./metaobject-validation";

const sourceMeta = [
  {
    id: "gid://shopify/MetaobjectDefinition/1",
    name: "Author",
    type: "author",
  },
];
const targetMeta = [
  {
    id: "gid://shopify/MetaobjectDefinition/9",
    name: "Authors",
    type: "author",
  },
];
const definition: CopyDefinition = {
  access: {
    admin: "PUBLIC_READ_WRITE",
    customerAccount: "NONE",
    storefront: "PUBLIC_READ",
  },
  capabilities: {
    adminFilterable: { enabled: true },
    uniqueValues: { enabled: false },
  },
  constraints: null,
  description: "Author details",
  id: "source",
  key: "author",
  name: "Author",
  namespace: "custom",
  ownerType: "PRODUCT",
  pinnedPosition: 0,
  standardTemplate: null,
  type: { name: "metaobject_reference" },
  validations: [
    { name: "metaobject_definition_id", value: sourceMeta[0]?.id ?? "" },
  ],
};
const draft: Draft = {
  description: "",
  id: "1",
  key: "author",
  name: "Author",
  namespace: "custom",
  type: "metaobject_reference",
};

describe("metaobject creation", () => {
  it("requires a selection only for metaobject reference types", () => {
    expect(validateDrafts([draft])).toContain("metaobject");
    expect(
      validateDrafts([{ ...draft, type: "product_reference" }])
    ).toBeNull();
    expect(referenceValidations("product_reference", [])).toEqual([]);
  });
  it("encodes one allowed definition versus a JSON array for mixed references", () => {
    expect(referenceValidations("list.metaobject_reference", ["a"])).toEqual([
      { name: "metaobject_definition_id", value: "a" },
    ]);
    expect(referenceValidations("mixed_reference", ["a", "b"])).toEqual([
      { name: "metaobject_definition_ids", value: '["a","b"]' },
    ]);
    expect(() =>
      referenceValidations("metaobject_reference", ["a", "b"])
    ).toThrow();
  });
});

describe("cross-store definition copying", () => {
  it("accepts the empty constraints object returned for ordinary definitions", () => {
    expect(
      buildCopyInput(
        { ...definition, constraints: { key: null } },
        defaultMappings(sourceMeta, targetMeta),
        targetMeta
      ).key
    ).toBe("author");
  });
  it("maps by type rather than display name and never forwards the source metaobject ID", () => {
    const input = buildCopyInput(
      definition,
      defaultMappings(sourceMeta, targetMeta),
      targetMeta
    );
    expect(input.validations).toEqual([
      { name: "metaobject_definition_id", value: targetMeta[0]?.id },
    ]);
    expect(input).toMatchObject({
      access: { customerAccount: "NONE", storefront: "PUBLIC_READ" },
      capabilities: { adminFilterable: { enabled: true } },
      ownerType: "PRODUCT",
      pin: true,
    });
    expect(input).not.toHaveProperty("id");
    expect(input.access).not.toHaveProperty("admin");
  });
  it("blocks missing mappings and mappings to IDs outside the target store", () => {
    expect(() => buildCopyInput(definition, {}, targetMeta)).toThrow("Choose");
    expect(() =>
      buildCopyInput(
        definition,
        { [sourceMeta[0]?.id ?? ""]: "bad" },
        targetMeta
      )
    ).toThrow("Choose");
  });
  it("maps mixed reference arrays and type-based validations", () => {
    const mixed = {
      ...definition,
      type: { name: "list.mixed_reference" },
      validations: [
        { name: "metaobject_definition_types", value: '["author"]' },
      ],
    };
    expect(referenceKeys(mixed)).toEqual(["author"]);
    expect(
      buildCopyInput(mixed, defaultMappings(sourceMeta, targetMeta), targetMeta)
        .validations
    ).toEqual([
      {
        name: "metaobject_definition_ids",
        value: JSON.stringify([targetMeta[0]?.id]),
      },
    ]);
  });
  it("preserves ordinary validations and blocks unsupported store-local IDs", () => {
    const text = {
      ...definition,
      type: { name: "single_line_text_field" },
      validations: [{ name: "max", value: "40" }],
    };
    expect(buildCopyInput(text, {}, []).validations).toEqual(text.validations);
    expect(() =>
      buildCopyInput(
        {
          ...text,
          validations: [{ name: "other", value: "gid://shopify/Product/1" }],
        },
        {},
        []
      )
    ).toThrow("store-specific");
  });
  it("does not silently turn constrained or app-owned definitions into ordinary definitions", () => {
    expect(() =>
      buildCopyInput(
        { ...definition, constraints: { key: "category" } },
        {},
        []
      )
    ).toThrow("constrained");
    expect(() =>
      buildCopyInput({ ...definition, namespace: "app--123--custom" }, {}, [])
    ).toThrow("App-owned");
    expect(() =>
      buildCopyInput(
        { ...definition, standardTemplate: { id: "template" } },
        {},
        []
      )
    ).toThrow("standard");
  });
});
