const TEMPLATE = /^\{\{\s*\$json(?:\.|\[")?([^"\]}]+?)(?:"\])?\s*\}\}$/;
const OPERATION = /\b(query|mutation)\s+([A-Za-z_]\w*)/;

const OPERATORS: Record<string, string> = {
  contains: "contains",
  endsWith: "ends with",
  eq: "=",
  gt: ">",
  gte: "≥",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  lt: "<",
  lte: "≤",
  neq: "≠",
  startsWith: "starts with",
};

const DELIMITERS: Record<string, string> = {
  ",": "comma",
  ";": "semicolon",
  "\t": "tab",
  "|": "pipe",
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown) => (Array.isArray(value) ? value : []);

/** `{{ $json.order.totalPrice }}` reads as `order.totalPrice`; other text is kept. */
export const readableTemplate = (value: string) =>
  TEMPLATE.exec(value.trim())?.[1] ?? value;

const conditionSummary = (config: Record<string, unknown>) => {
  const conditions = list(config.conditions) as Record<string, unknown>[];
  const [first] = conditions;
  if (!first) {
    return "";
  }
  const operator = OPERATORS[text(first.operator)] ?? text(first.operator);
  const unary = first.operator === "isEmpty" || first.operator === "isNotEmpty";
  const head = [
    readableTemplate(text(first.left)),
    operator,
    unary ? "" : text(first.right),
  ]
    .filter(Boolean)
    .join(" ");
  return conditions.length > 1 ? `${head} +${conditions.length - 1}` : head;
};

const SUMMARIES: Record<string, (config: Record<string, unknown>) => string> = {
  "data.parseCsv": (config) =>
    `${config.hasHeader === false ? "No header row" : "Header row"} · ${DELIMITERS[text(config.delimiter)] ?? "comma"}`,
  "data.setFields": (config) => {
    const parts = [
      [list(config.set).length, "set"],
      [list(config.rename).length, "renamed"],
      [list(config.remove).length, "removed"],
    ].filter(([count]) => Number(count) > 0);
    return parts.map(([count, verb]) => `${count} ${verb}`).join(" · ");
  },
  "logic.filter": conditionSummary,
  "logic.if": conditionSummary,
  "logic.switch": (config) =>
    `${list(config.cases).length} cases on ${readableTemplate(text(config.value))}`,
  "shopify.addTags": (config) => list(config.tags).filter(Boolean).join(", "),
  "shopify.bulkMutation": (config) =>
    OPERATION.exec(text(config.mutation))?.[2] ?? "",
  "shopify.findOrder": (config) =>
    text(config.value)
      ? `${text(config.by) || "name"} = ${text(config.value)}`
      : "",
  "shopify.graphql": (config) => {
    const match = OPERATION.exec(text(config.document));
    return match ? `${match[1]} ${match[2]}` : "";
  },
  "trigger.manual": (config) => {
    const inputs = list(config.inputs) as Record<string, unknown>[];
    if (inputs.length === 0) {
      return "No inputs";
    }
    const labels = inputs.map((input) => text(input.label)).filter(Boolean);
    return `${inputs.length === 1 ? "Input" : "Inputs"}: ${labels.join(", ")}`;
  },
  "trigger.schedule": (config) =>
    [text(config.cron), text(config.timezone)].filter(Boolean).join(" · "),
  "trigger.webhook": (config) =>
    text(config.topic).toLowerCase().replace("_", "/"),
};

/** One line saying how a step is configured, for its card and the trace. */
export const summarizeNode = (
  nodeType: string,
  config: Record<string, unknown>
): string => SUMMARIES[nodeType]?.(config) ?? "";
