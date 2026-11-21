/**
 * What the browser and the server both need to know about functions. Nothing
 * here touches the database, the runner or Node APIs.
 *
 * The limits mirror the runner agent's protocol (`apps/runner/src/protocol.ts`),
 * which is deployed separately and checks them again.
 */

export const FUNCTION_RUNTIMES = ["NODE", "PYTHON"] as const;
export type FunctionRuntime = (typeof FUNCTION_RUNTIMES)[number];

export const FUNCTION_LIMITS = {
  defaultMemoryMb: 256,
  defaultTimeoutSeconds: 60,
  descriptionLength: 500,
  fileBytes: 256 * 1024,
  files: 50,
  memoryMb: [128, 256, 512, 1024],
  nameLength: 100,
  outputBytes: 1024 * 1024,
  pathLength: 200,
  /** Older runs of a function are deleted beyond this many. */
  runsKept: 200,
  sourceBytes: 1024 * 1024,
  timeoutSeconds: 900,
} as const;

export const RUNTIME_LABELS: Record<FunctionRuntime, string> = {
  NODE: "Node.js (TypeScript)",
  PYTHON: "Python 3.13",
};

/** The file a runtime starts from, in order of preference. */
export const ENTRY_FILES: Record<FunctionRuntime, readonly string[]> = {
  NODE: ["index.ts", "index.mts", "index.js", "index.mjs"],
  PYTHON: ["main.py"],
};

export const entryFileOf = (
  runtime: FunctionRuntime,
  paths: Iterable<string>
): string | undefined => {
  const present = new Set(paths);
  return ENTRY_FILES[runtime].find((path) => present.has(path));
};

const PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * A path that stays inside the function's directory: relative, made of plain
 * segments, and outside the directory installed packages are mounted at.
 */
export const isSafeRelativePath = (path: string): boolean => {
  if (path.length === 0 || path.length > FUNCTION_LIMITS.pathLength) {
    return false;
  }
  const segments = path.split("/");
  return (
    segments[0] !== "node_modules" &&
    segments.every(
      (segment) =>
        PATH_SEGMENT.test(segment) && segment !== "." && segment !== ".."
    )
  );
};

export const utf8Length = (text: string): number =>
  new TextEncoder().encode(text).length;

export interface FunctionFileInput {
  content: string;
  path: string;
}

/** Why a set of files cannot be saved, or undefined when it can. */
export const filesProblem = (
  files: readonly FunctionFileInput[]
): string | undefined => {
  if (files.length === 0) {
    return "A function needs at least one file.";
  }
  if (files.length > FUNCTION_LIMITS.files) {
    return `A function can have at most ${FUNCTION_LIMITS.files} files.`;
  }
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    if (!isSafeRelativePath(file.path)) {
      return `"${file.path}" is not a valid file path. Use letters, digits, ".", "-" and "_" in folders separated by "/".`;
    }
    if (seen.has(file.path)) {
      return `"${file.path}" is listed twice.`;
    }
    seen.add(file.path);
    const bytes = utf8Length(file.content);
    if (bytes > FUNCTION_LIMITS.fileBytes) {
      return `"${file.path}" is larger than ${FUNCTION_LIMITS.fileBytes / 1024} KB.`;
    }
    total += bytes;
  }
  if (total > FUNCTION_LIMITS.sourceBytes) {
    return `The files are larger than ${FUNCTION_LIMITS.sourceBytes / 1024} KB in total.`;
  }
};

/** The files a new function starts with. */
export const STARTER_FILES: Record<FunctionRuntime, FunctionFileInput[]> = {
  NODE: [
    {
      content: `/**
 * Runs when the function is called. Each parameter becomes a field in the
 * run form, and the return value is shown as the result.
 *
 * @param name - Who to greet.
 * @param times - How many times to say it.
 */
export async function main(name: string, times: number = 1) {
  console.log("Greeting", name);
  return { message: \`Hello, \${name}! \`.repeat(times).trim() };
}
`,
      path: "index.ts",
    },
  ],
  PYTHON: [
    {
      content: `def main(name: str, times: int = 1):
    """Runs when the function is called. Each parameter becomes a field in
    the run form, and the return value is shown as the result."""
    print("Greeting", name)
    return {"message": " ".join([f"Hello, {name}!"] * times)}
`,
      path: "main.py",
    },
  ],
};

export type ParamType = "string" | "number" | "integer" | "boolean" | "array";

/** One parameter of `main`. No `type` means any JSON value. */
export interface ParamSchema {
  default?: unknown;
  description?: string;
  enum?: string[];
  items?: { type: Exclude<ParamType, "array"> };
  type?: ParamType;
}

export interface ParamsSchema {
  properties: Record<string, ParamSchema>;
  required: string[];
  type: "object";
  /** Parameter names in declaration order. */
  "x-order": string[];
}

export const isParamsSchema = (value: unknown): value is ParamsSchema =>
  typeof value === "object" &&
  value !== null &&
  "properties" in value &&
  "x-order" in value &&
  Array.isArray((value as ParamsSchema)["x-order"]);

const matchesType = (
  type: Exclude<ParamType, "array">,
  value: unknown
): boolean => {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return false;
  }
};

const TYPE_NAMES: Record<ParamType, string> = {
  array: "a list",
  boolean: "true or false",
  integer: "a whole number",
  number: "a number",
  string: "text",
};

const valueProblem = (
  field: ParamSchema,
  value: unknown
): string | undefined => {
  if (!field.type) {
    return;
  }
  if (field.type === "array") {
    if (!Array.isArray(value)) {
      return `must be ${TYPE_NAMES.array}`;
    }
    const itemType = field.items?.type;
    if (itemType && !value.every((item) => matchesType(itemType, item))) {
      return `must be a list of ${TYPE_NAMES[itemType]} values`;
    }
    return;
  }
  if (!matchesType(field.type, value)) {
    return `must be ${TYPE_NAMES[field.type]}`;
  }
  if (field.enum && !field.enum.includes(value as string)) {
    return `must be one of ${field.enum.join(", ")}`;
  }
};

export type ParamsValidation =
  | { ok: true; params: Record<string, unknown> }
  | { errors: Record<string, string>; ok: false };

/**
 * Checks run parameters against the schema read from `main`. A missing
 * optional parameter is left out, so the function's own default applies.
 * Without a schema any JSON object is accepted.
 */
export const validateParams = (
  schema: ParamsSchema | null | undefined,
  params: Record<string, unknown>
): ParamsValidation => {
  if (!schema) {
    return { ok: true, params };
  }
  const errors: Record<string, string> = {};
  const accepted: Record<string, unknown> = {};
  for (const name of Object.keys(params)) {
    if (!(name in schema.properties)) {
      errors[name] = "is not a parameter of main";
    }
  }
  for (const name of schema["x-order"]) {
    const field = schema.properties[name] ?? {};
    const value = params[name];
    if (value === undefined || value === null) {
      if (schema.required.includes(name)) {
        errors[name] = "is required";
      }
      continue;
    }
    const problem = valueProblem(field, value);
    if (problem) {
      errors[name] = problem;
    } else {
      accepted[name] = value;
    }
  }
  return Object.keys(errors).length > 0
    ? { errors, ok: false }
    : { ok: true, params: accepted };
};

/** One line describing every problem, for an error message. */
export const describeParamErrors = (errors: Record<string, string>): string =>
  Object.entries(errors)
    .map(([name, problem]) => `${name} ${problem}`)
    .join("; ");

export const FUNCTION_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELED",
] as const;
export type FunctionRunStatus = (typeof FUNCTION_RUN_STATUSES)[number];

export const ACTIVE_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
] as const satisfies readonly FunctionRunStatus[];

export const isActiveRunStatus = (status: FunctionRunStatus): boolean =>
  (ACTIVE_RUN_STATUSES as readonly FunctionRunStatus[]).includes(status);

/**
 * Files a runtime installs packages from, at the function's root. The first
 * one starts an install; the others are sent along when present.
 */
export const DEPS_MANIFESTS: Record<FunctionRuntime, readonly string[]> = {
  NODE: ["package.json", "package-lock.json"],
  PYTHON: ["requirements.txt"],
};

export const FUNCTION_DEPS_STATUSES = [
  "NONE",
  "BUILDING",
  "READY",
  "FAILED",
] as const;
export type FunctionDepsStatus = (typeof FUNCTION_DEPS_STATUSES)[number];

/** How much of an install's output is kept, from its end. */
export const DEPS_LOG_CHARACTERS = 16 * 1024;

/** The manifests among a function's files; empty when it installs nothing. */
export const manifestsOf = (
  runtime: FunctionRuntime,
  files: readonly FunctionFileInput[]
): FunctionFileInput[] => {
  const [required] = DEPS_MANIFESTS[runtime];
  if (!files.some((file) => file.path === required)) {
    return [];
  }
  return DEPS_MANIFESTS[runtime].flatMap((path) => {
    const file = files.find((candidate) => candidate.path === path);
    return file ? [{ content: file.content, path }] : [];
  });
};

export const ENV_VAR_LIMITS = {
  nameLength: 100,
  /** Values shorter than this are not scrubbed from output. */
  scrubMinLength: 6,
  valueBytes: 8 * 1024,
  variables: 50,
} as const;

const ENV_VAR_NAME = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_ENV_NAMES = new Set([
  "HOME",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PATH",
  "PYTHONHOME",
  "PYTHONPATH",
]);
const RESERVED_ENV_PREFIXES = ["FN_", "LD_", "WIZDEK_"];

/** Why a variable name cannot be used, or null when it can. */
export const envVarNameProblem = (name: string): string | null => {
  if (name.length === 0 || name.length > ENV_VAR_LIMITS.nameLength) {
    return `Use 1 to ${ENV_VAR_LIMITS.nameLength} characters.`;
  }
  if (!ENV_VAR_NAME.test(name)) {
    return "Use capital letters, digits and underscores, not starting with a digit.";
  }
  if (
    RESERVED_ENV_NAMES.has(name) ||
    RESERVED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
  ) {
    return `${name} is reserved by the runtime.`;
  }
  return null;
};

export const HTTP_TRIGGER = {
  bodyBytes: 1024 * 1024,
  /** The header that carries the token; `Authorization: Bearer` also works. */
  header: "x-function-token",
  pathPrefix: "/api/fn",
  requestsPerMinute: 60,
  tokenPrefix: "wfn_",
  /** How long a call waits for the run before answering with its id. */
  waitMs: 90_000,
} as const;

export const SCHEDULE_LIMITS = { perFunction: 5 } as const;

export const GRANT_KINDS = ["STORE", "DATABASE"] as const;
export type GrantKind = (typeof GRANT_KINDS)[number];

/** How scripts name a granted resource, e.g. `db("analytics")`. */
export const GRANT_ALIAS = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NOT_ALIAS = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

/** A default alias from a resource's name: lower case, dashes, 40 characters. */
export const aliasOf = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(NOT_ALIAS, "-")
    .replace(EDGE_DASHES, "")
    .slice(0, 40)
    .replace(EDGE_DASHES, "");
  return slug || "resource";
};

/** What the built-in helpers may do for one run. */
export const RUNTIME_LIMITS = {
  /** Most calls a run may have in flight, and of them database calls. */
  callsInFlight: 20,
  callTimeoutMs: 60_000,
  databaseCallsInFlight: 4,
  maxBodyBytes: 1024 * 1024,
  maxResponseBytes: 10 * 1024 * 1024,
  maxRows: 10_000,
  transactionStatements: 50,
} as const;

export const RUNTIME_PATH_PREFIX = "/api/fn-runtime";

/** Variables every run gets for the `wizdek` module. */
export const RUNTIME_ENV = {
  functionId: "WIZDEK_FUNCTION_ID",
  organizationId: "WIZDEK_ORGANIZATION_ID",
  runId: "WIZDEK_RUN_ID",
  token: "WIZDEK_RUNTIME_TOKEN",
  trigger: "WIZDEK_TRIGGER",
  url: "WIZDEK_RUNTIME_URL",
} as const;

export const RUNTIME_TOKEN_PREFIX = "wfr_";

const READ_KEYWORDS = new Set(["explain", "select", "show"]);
const LEADING_COMMENTS = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/;
const FIRST_WORD = /^[a-z]+/i;

/**
 * Whether a statement only reads, judged by its first keyword after any
 * comments. A `with` query may write, so it counts as a write. Each call
 * carries exactly one statement, which the database enforces.
 */
export const isReadStatement = (sql: string): boolean => {
  const rest = sql.replace(LEADING_COMMENTS, "");
  const word = FIRST_WORD.exec(rest)?.[0]?.toLowerCase() ?? "";
  return READ_KEYWORDS.has(word);
};

/**
 * Types of the built-in `wizdek` module for the editor. Kept in step with
 * `apps/runner/runtimes/node/wizdek.mjs`, which the runtime image ships.
 */
export const WIZDEK_SDK_TYPES = `
declare module "wizdek" {
  /** A helper call that failed; status is the runtime API's HTTP status. */
  export class WizdekError extends Error {
    readonly status: number | null;
    /** Shopify's errors, for a GraphQL call. */
    readonly errors: unknown[] | null;
    /** Shopify's whole answer, for a GraphQL call. */
    readonly response: unknown;
  }

  /** What the run is: ids, and what started it. */
  export const ctx: {
    readonly functionId: string | null;
    readonly organizationId: string | null;
    readonly runId: string | null;
    readonly trigger: "MANUAL" | "HTTP" | "SCHEDULE" | null;
  };

  export interface QueryResult<Row = Record<string, unknown>> {
    command: string;
    fields: { dataTypeId: number; name: string }[];
    rowCount: number | null;
    rows: Row[];
    /** True when rows were cut at 10 000 rows or 10 MB. */
    truncated: boolean;
  }

  export interface Statement {
    params?: unknown[];
    sql: string;
  }

  export interface Database {
    /** Runs one statement and returns its rows. Use $1, $2 for values. */
    query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Row[]>;
    /** Runs one statement and returns how many rows it changed. */
    execute(sql: string, params?: unknown[]): Promise<number | null>;
    /** Runs one statement and returns its whole result. */
    run<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
    /** Runs statements in one transaction: all of them, or none when one fails. */
    transaction(statements: Statement[]): Promise<QueryResult[]>;
  }

  /** A database connection granted to this function, by alias or id. */
  export function db(alias: string): Database;

  export interface GraphqlOptions {
    apiVersion?: string;
    operationName?: string;
  }

  export interface GraphqlResponse<Data = any> {
    data: Data;
    extensions?: Record<string, unknown>;
  }

  export interface Store {
    /** Runs an Admin API query or mutation. Throttled calls are retried; other errors throw. */
    graphql<Data = any>(
      query: string,
      variables?: Record<string, unknown>,
      options?: GraphqlOptions
    ): Promise<GraphqlResponse<Data>>;
    /**
     * Yields every node of a connection. The query takes $cursor: String for
     * after: and selects pageInfo { hasNextPage endCursor }.
     */
    paginate<Node = any>(
      query: string,
      variables?: Record<string, unknown>,
      options?: GraphqlOptions & { path?: string }
    ): AsyncGenerator<Node, void, undefined>;
  }

  /** A Shopify store granted to this function, by alias or id. */
  export function shopify(alias: string): Store;

  /** The stores this function may use, by alias. */
  export const stores: { list(): Promise<string[]> };
  /** The database connections this function may use, by alias. */
  export const databases: { list(): Promise<string[]> };
}
`;
