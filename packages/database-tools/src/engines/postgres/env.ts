import type { DatabaseTarget } from "../types";

const CONNECT_TIMEOUT_SECONDS = "10";

/**
 * The complete environment for a PostgreSQL client tool. The connection,
 * password included, travels in libpq's variables so it never appears in the
 * process arguments, which other local users can read. Nothing else from the
 * API process, such as its own DATABASE_URL, is passed on.
 */
export const libpqEnvironment = (
  target?: DatabaseTarget
): Record<string, string> => {
  const env: Record<string, string> = {
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
    PGAPPNAME: "shopify-toolkit",
    PGCONNECT_TIMEOUT: CONNECT_TIMEOUT_SECONDS,
  };
  if (!target) {
    return env;
  }
  env.PGDATABASE = target.databaseName;
  env.PGHOST = target.host;
  env.PGPORT = String(target.port);
  env.PGUSER = target.username;
  if (target.password) {
    env.PGPASSWORD = target.password;
  }
  if (target.sslMode) {
    env.PGSSLMODE = target.sslMode;
  }
  return env;
};

/** Arguments for a full dump; the target comes from the environment. */
export const pgDumpArguments = (outputPath: string): string[] => [
  "--format=custom",
  "--no-password",
  `--file=${outputPath}`,
];
