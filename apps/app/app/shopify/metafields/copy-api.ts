import { type Definition, execute } from "./metafields-api";
import type { MetaobjectDefinition } from "./metaobject-api";
import { needsMetaobject, type Validation } from "./metaobject-validation";

export interface CopyDefinition extends Definition {
  access: { storefront: string; customerAccount: string; admin: string };
  capabilities: Record<string, { enabled: boolean }>;
  constraints: { key: string | null } | null;
  ownerType: string;
  pinnedPosition: number | null;
  standardTemplate: { id: string } | null;
  validations: Validation[];
}
export async function loadCopyDefinitions(
  storeId: string,
  ids: string[]
): Promise<CopyDefinition[]> {
  const result: CopyDefinition[] = [];
  for (let index = 0; index < ids.length; index += 50) {
    const data = await execute<{ nodes: (CopyDefinition | null)[] }>(
      storeId,
      `query CopyDefinitions($ids: [ID!]!) { nodes(ids: $ids) { ... on MetafieldDefinition {
      id name namespace key description ownerType type { name } validations { name value }
      access { admin storefront customerAccount } pinnedPosition standardTemplate { id } constraints { key }
      capabilities { adminFilterable { enabled } analyticsQueryable { enabled } cartToOrderCopyable { enabled } smartCollectionCondition { enabled } uniqueValues { enabled } }
    } } }`,
      { ids: ids.slice(index, index + 50) }
    );
    if (data.nodes.some((node) => !node)) {
      throw new Error(
        "A selected source definition is no longer available. Refresh the source list."
      );
    }
    result.push(
      ...data.nodes.filter((node): node is CopyDefinition => Boolean(node))
    );
  }
  return result;
}
const REFERENCE_VALIDATIONS = new Set([
  "metaobject_definition_id",
  "metaobject_definition_ids",
  "metaobject_definition_type",
  "metaobject_definition_types",
]);
export function referenceKeys(definition: CopyDefinition): string[] {
  return definition.validations
    .filter((validation) => REFERENCE_VALIDATIONS.has(validation.name))
    .flatMap((validation) => {
      if (
        validation.name.endsWith("_ids") ||
        validation.name.endsWith("_types")
      ) {
        const parsed: unknown = JSON.parse(validation.value);
        if (
          !(
            Array.isArray(parsed) &&
            parsed.every((value) => typeof value === "string")
          )
        ) {
          throw new Error("Invalid metaobject reference validation.");
        }
        return parsed;
      }
      return [validation.value];
    });
}
export function defaultMappings(
  source: MetaobjectDefinition[],
  target: MetaobjectDefinition[]
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const item of source) {
    const match = target.find((candidate) => candidate.type === item.type);
    if (match) {
      mapping[item.id] = match.id;
      mapping[item.type] = match.id;
    }
  }
  return mapping;
}
export function copyBlockReason(definition: CopyDefinition): string | null {
  if (
    definition.standardTemplate ||
    definition.namespace === "shopify" ||
    definition.namespace.startsWith("shopify--")
  ) {
    return "Shopify standard definitions must be enabled in the destination store.";
  }
  if (
    definition.namespace.startsWith("app--") ||
    definition.namespace.startsWith("$app")
  ) {
    return "App-owned definitions must be managed by their owning app.";
  }
  if (definition.constraints?.key) {
    return "Resource-constrained definitions are not supported by this copier yet.";
  }
  return null;
}
export function buildCopyInput(
  definition: CopyDefinition,
  mappings: Record<string, string>,
  targetMetaobjects: MetaobjectDefinition[]
) {
  const blocked = copyBlockReason(definition);
  if (blocked) {
    throw new Error(blocked);
  }
  if (
    needsMetaobject(definition.type.name) &&
    !referenceKeys(definition).length
  ) {
    throw new Error("Source definition has no allowed metaobject definitions.");
  }
  const validations = definition.validations.map((validation) => {
    if (!REFERENCE_VALIDATIONS.has(validation.name)) {
      // Shopify taxonomy IDs are global; other resource IDs are store-specific.
      if (
        validation.value.includes("gid://shopify/") &&
        !validation.value.includes("gid://shopify/Taxonomy")
      ) {
        throw new Error(
          `Cannot safely copy store-specific validation: ${validation.name}.`
        );
      }
      return { name: validation.name, value: validation.value };
    }
    const keys = referenceKeys({ ...definition, validations: [validation] });
    const ids = keys.map((key) => {
      const id = mappings[key];
      if (!(id && targetMetaobjects.some((item) => item.id === id))) {
        throw new Error(`Choose a destination metaobject for ${key}.`);
      }
      return id;
    });
    const multiple =
      validation.name.endsWith("_ids") || validation.name.endsWith("_types");
    if (new Set(ids).size !== ids.length) {
      throw new Error(
        "Each source metaobject must map to a different destination type."
      );
    }
    return {
      name: multiple ? "metaobject_definition_ids" : "metaobject_definition_id",
      value: multiple ? JSON.stringify(ids) : (ids[0] ?? ""),
    };
  });
  return {
    access: {
      customerAccount: definition.access.customerAccount,
      storefront: definition.access.storefront,
    },
    capabilities: Object.fromEntries(
      Object.entries(definition.capabilities)
        .filter(([, capability]) => capability.enabled)
        .map(([name]) => [name, { enabled: true }])
    ),
    description: definition.description ?? "",
    key: definition.key,
    name: definition.name,
    namespace: definition.namespace,
    ownerType: definition.ownerType,
    pin: definition.pinnedPosition !== null,
    type: definition.type.name,
    validations,
  };
}
