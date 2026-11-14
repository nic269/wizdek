const TYPE_LABELS: Record<string, string> = {
  boolean: "True or false",
  date_time: "Date and time",
  id: "ID",
  json: "JSON",
  multi_line_text_field: "Multi-line text",
  number_decimal: "Decimal",
  number_integer: "Integer",
  rich_text_field: "Rich text",
  single_line_text_field: "Single line text",
  url: "URL",
};

export const baseType = (type: string) =>
  type.startsWith("list.") ? type.slice(5) : type;

export function typeLabel(type: string): string {
  const base = baseType(type);
  const words = base.replaceAll("_", " ");
  const label =
    TYPE_LABELS[base] ?? words.charAt(0).toUpperCase() + words.slice(1);
  return type.startsWith("list.") ? `${label} · List of values` : label;
}

/** Preserve the selected value mode when the next type supports it. */
export function changeBaseType(
  current: string,
  next: string,
  supported: Set<string>
): string {
  if (current.startsWith("list.") && supported.has(`list.${next}`)) {
    return `list.${next}`;
  }
  return supported.has(next) ? next : `list.${next}`;
}
