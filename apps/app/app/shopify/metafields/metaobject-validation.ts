import { baseType } from "./metafield-types";
export interface Validation {
  name: string;
  value: string;
}
export const needsMetaobject = (type: string) =>
  ["metaobject_reference", "mixed_reference"].includes(baseType(type));
export const isMixed = (type: string) => baseType(type) === "mixed_reference";
export function referenceValidations(
  type: string,
  ids: string[]
): Validation[] {
  if (!needsMetaobject(type)) {
    return [];
  }
  if (!ids.length || (!isMixed(type) && ids.length !== 1)) {
    throw new Error("Choose the allowed metaobject definition(s).");
  }
  return [
    {
      name: isMixed(type)
        ? "metaobject_definition_ids"
        : "metaobject_definition_id",
      value: isMixed(type) ? JSON.stringify(ids) : (ids[0] ?? ""),
    },
  ];
}
