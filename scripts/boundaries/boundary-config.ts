export interface BoundaryConfig {
  clientSafeEntrypoints: Record<string, string[]>;
  forbiddenImportExceptions: Record<string, Record<string, string[]>>;
  forbiddenPackageImports: Record<string, string[]>;
  packageRules: Record<string, string[]>;
}

const CONFIG_KEYS: Readonly<Record<string, true>> = {
  $schema: true,
  clientSafeEntrypoints: true,
  forbiddenImportExceptions: true,
  forbiddenPackageImports: true,
  packageRules: true,
};
const WHITESPACE_PATTERN = /\s/u;
const SCOPED_SPECIFIER_PATTERN = /^@[^/]+\/[^/]+(?:\/[^/]+)*$/u;
const DRIVE_PATH_PATTERN = /^[A-Za-z]:/u;

const assertStringArrayMap = (
  value: unknown,
  field: string
): Record<string, string[]> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const result: Record<string, string[]> = {};
  for (const [key, entries] of Object.entries(value)) {
    if (key.length === 0 || !Array.isArray(entries)) {
      throw new Error(`${field}.${key} must be an array of non-empty strings`);
    }
    if (
      entries.some((entry) => typeof entry !== "string" || entry.length === 0)
    ) {
      throw new Error(`${field}.${key} must be an array of non-empty strings`);
    }
    if (new Set(entries).size !== entries.length) {
      throw new Error(`${field}.${key} contains duplicate entries`);
    }
    result[key] = entries;
  }
  return result;
};

const validImportSpecifier = (specifier: string) => {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.includes("\\") ||
    specifier.includes("//") ||
    specifier.endsWith("/") ||
    WHITESPACE_PATTERN.test(specifier)
  ) {
    return false;
  }
  return !specifier.startsWith("@") || SCOPED_SPECIFIER_PATTERN.test(specifier);
};

const validExceptionPath = (path: string) => {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    DRIVE_PATH_PATTERN.test(path) ||
    path.includes("\\") ||
    path.includes("*")
  ) {
    return false;
  }
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
};

const parseForbiddenImports = (value: unknown) => {
  if (value === undefined) {
    return {};
  }
  const parsed = assertStringArrayMap(value, "forbiddenPackageImports");
  for (const [owner, rules] of Object.entries(parsed)) {
    for (const rule of rules) {
      if (!validImportSpecifier(rule)) {
        throw new Error(`Invalid forbidden import ${rule} for ${owner}`);
      }
    }
  }
  return parsed;
};

const parseExceptions = (
  value: unknown,
  forbiddenImports: Record<string, string[]>
) => {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("forbiddenImportExceptions must be an object");
  }

  const result: Record<string, Record<string, string[]>> = {};
  for (const [owner, paths] of Object.entries(value)) {
    const rules = forbiddenImports[owner];
    if (!rules) {
      throw new Error(`Forbidden import exception has unknown owner ${owner}`);
    }
    const parsedPaths = assertStringArrayMap(
      paths,
      `forbiddenImportExceptions.${owner}`
    );
    for (const [path, exceptions] of Object.entries(parsedPaths)) {
      if (!validExceptionPath(path)) {
        throw new Error(`Invalid forbidden import exception path ${path}`);
      }
      const unknownRule = exceptions.find(
        (exception) => !rules.includes(exception)
      );
      if (unknownRule) {
        throw new Error(
          `Forbidden import exception ${owner}:${path} references unknown rule ${unknownRule}`
        );
      }
    }
    result[owner] = parsedPaths;
  }
  return result;
};

export const parseBoundaryConfig = (value: unknown): BoundaryConfig => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Boundary config must be an object");
  }
  const object = value as Record<string, unknown>;
  const unsupportedKey = Object.keys(object).find(
    (key) => CONFIG_KEYS[key] !== true
  );
  if (unsupportedKey) {
    throw new Error(`Unsupported boundary config key: ${unsupportedKey}`);
  }

  const forbiddenPackageImports = parseForbiddenImports(
    object.forbiddenPackageImports
  );
  return {
    clientSafeEntrypoints: assertStringArrayMap(
      object.clientSafeEntrypoints,
      "clientSafeEntrypoints"
    ),
    forbiddenImportExceptions: parseExceptions(
      object.forbiddenImportExceptions,
      forbiddenPackageImports
    ),
    forbiddenPackageImports,
    packageRules: assertStringArrayMap(object.packageRules, "packageRules"),
  };
};
