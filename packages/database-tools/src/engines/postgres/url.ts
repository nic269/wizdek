import { DatabaseToolsError } from "../../errors";
import type { DatabaseTarget } from "../types";

export const POSTGRES_SCHEMES = ["postgresql", "postgres"] as const;
const DEFAULT_PORT = 5432;
const SSL_MODES = new Set([
  "disable",
  "allow",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
]);
const IPV6_BRACKETS = /^\[(.*)\]$/;
const LEADING_SLASH = /^\//;

const invalid = (reason: string) =>
  new DatabaseToolsError(
    "INVALID_URL",
    `${reason} Expected postgresql://user:password@host:5432/database.`
  );

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalid("The URL contains an invalid percent-encoded character.");
  }
};

/**
 * Reads a PostgreSQL connection URL. Only `sslmode` is kept from the query
 * string: URLs written for an ORM carry parameters such as `schema` or
 * `connection_limit` that the PostgreSQL client tools reject.
 */
export const parsePostgresUrl = (url: string): DatabaseTarget => {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw invalid("The connection URL could not be read.");
  }
  const scheme = parsed.protocol.replace(":", "");
  if (!(POSTGRES_SCHEMES as readonly string[]).includes(scheme)) {
    throw invalid("This is not a PostgreSQL URL.");
  }

  const host = parsed.hostname.replace(IPV6_BRACKETS, "$1");
  if (!host) {
    throw invalid("The URL has no host.");
  }
  const username = decode(parsed.username);
  if (!username) {
    throw invalid("The URL has no user name.");
  }
  const databaseName = decode(parsed.pathname.replace(LEADING_SLASH, ""));
  if (!databaseName || databaseName.includes("/")) {
    throw invalid("The URL has no database name.");
  }
  const port = parsed.port ? Number(parsed.port) : DEFAULT_PORT;

  const sslMode = parsed.searchParams.get("sslmode") ?? undefined;
  if (sslMode !== undefined && !SSL_MODES.has(sslMode)) {
    throw invalid(`The sslmode "${sslMode}" is not one PostgreSQL accepts.`);
  }

  return {
    databaseName,
    host,
    password: decode(parsed.password),
    port,
    username,
    ...(sslMode ? { sslMode } : {}),
  };
};
