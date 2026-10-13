export interface TemplateScope {
  /** The item the node is processing. */
  json: unknown;
  /** Facts about the run: its id, flow, store and organization. */
  run: unknown;
  /** The values the run was started with. */
  trigger: unknown;
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

const TEMPLATE_PATTERN = /\{\{([\s\S]*?)\}\}/g;
const WHOLE_TEMPLATE_PATTERN = /^\s*\{\{([\s\S]*?)\}\}\s*$/;
const ROOT_PATTERN = /^\$(json|trigger|run)/;
const SEGMENT_PATTERN =
  /^(?:\.([A-Za-z_$][\w$]*)|\[\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\d+))\s*\])/;
const ESCAPED_CHARACTER = /\\(.)/g;

/** Names that would reach an object's prototype instead of its data. */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

const parsePath = (
  expression: string
): { root: keyof TemplateScope; segments: string[] } => {
  const trimmed = expression.trim();
  const rootMatch = trimmed.match(ROOT_PATTERN);
  if (!rootMatch) {
    throw new TemplateError(
      `Template "${trimmed}" must start with $json, $trigger or $run.`
    );
  }
  const segments: string[] = [];
  let rest = trimmed.slice(rootMatch[0].length);
  while (rest.length > 0) {
    const match = rest.match(SEGMENT_PATTERN);
    if (!match) {
      throw new TemplateError(`Template "${trimmed}" is not a valid path.`);
    }
    const quoted = match[2] ?? match[3];
    const segment =
      match[1] ??
      (quoted === undefined
        ? match[4]
        : quoted.replace(ESCAPED_CHARACTER, "$1"));
    if (segment === undefined || FORBIDDEN_SEGMENTS.has(segment)) {
      throw new TemplateError(`Template "${trimmed}" uses a forbidden name.`);
    }
    segments.push(segment);
    rest = rest.slice(match[0].length);
  }
  return { root: rootMatch[1] as keyof TemplateScope, segments };
};

/**
 * Walks a path through plain data. Only own properties are read, so a path
 * can never reach inherited members. A missing step yields undefined.
 */
const readPath = (expression: string, scope: TemplateScope): unknown => {
  const { root, segments } = parsePath(expression);
  let current: unknown = scope[root];
  for (const segment of segments) {
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    ) {
      return;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const toText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

/**
 * Fills `{{ ... }}` placeholders from the scope. A string that is exactly one
 * placeholder returns the referenced value with its type; otherwise the
 * placeholders are replaced by text. Paths are looked up, never evaluated.
 */
export const resolveTemplate = (
  template: string,
  scope: TemplateScope
): unknown => {
  const whole = template.match(WHOLE_TEMPLATE_PATTERN);
  if (whole?.[1] !== undefined && !whole[1].includes("{{")) {
    return readPath(whole[1], scope);
  }
  return template.replace(TEMPLATE_PATTERN, (_match, expression: string) =>
    toText(readPath(expression, scope))
  );
};

/** Lists what is wrong with a template's placeholders, without resolving it. */
export const findTemplateErrors = (template: string): string[] => {
  const errors: string[] = [];
  for (const match of template.matchAll(TEMPLATE_PATTERN)) {
    try {
      parsePath(match[1] ?? "");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid template.");
    }
  }
  return errors;
};
