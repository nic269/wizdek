import type { ConnectionOptions } from "node:tls";
import pg from "pg";
import { DatabaseToolsError } from "../../errors";
import { redactSecrets } from "../../redact";
import type { DatabaseTarget, ServerVersion } from "../types";

const TIMEOUT_MS = 10_000;
const NO_SSL_SUPPORT = /does not support SSL/i;

type TlsSetting = false | ConnectionOptions;

/**
 * TLS settings that match what libpq, and so pg_dump, does for each sslmode.
 * The driver would otherwise verify certificates for `require`, and a check
 * would fail where the dump succeeds. Modes that tolerate either answer are
 * tried with TLS first, then without.
 */
const tlsAttempts = (sslMode: string | undefined): TlsSetting[] => {
  switch (sslMode) {
    case "disable":
      return [false];
    case "allow":
      return [false, { rejectUnauthorized: false }];
    case "require":
      return [{ rejectUnauthorized: false }];
    case "verify-ca":
      return [
        { checkServerIdentity: () => undefined, rejectUnauthorized: true },
      ];
    case "verify-full":
      return [{ rejectUnauthorized: true }];
    default:
      return [{ rejectUnauthorized: false }, false];
  }
};

const queryVersion = async (
  target: DatabaseTarget,
  ssl: TlsSetting
): Promise<ServerVersion> => {
  const client = new pg.Client({
    application_name: "shopify-toolkit",
    connectionTimeoutMillis: TIMEOUT_MS,
    database: target.databaseName,
    host: target.host,
    password: target.password,
    port: target.port,
    query_timeout: TIMEOUT_MS,
    ssl,
    user: target.username,
  });
  // A connection that drops later must not crash the process.
  client.on("error", () => undefined);
  try {
    await client.connect();
    const result = await client.query<{
      server_version: string;
      server_version_num: string;
    }>(
      "SELECT current_setting('server_version') AS server_version, current_setting('server_version_num') AS server_version_num"
    );
    const [row] = result.rows;
    if (!row) {
      throw new Error("The server did not report its version.");
    }
    return {
      major: Math.floor(Number(row.server_version_num) / 10_000),
      text: row.server_version,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
};

export const checkPostgres = async (
  target: DatabaseTarget
): Promise<ServerVersion> => {
  const attempts = tlsAttempts(target.sslMode);
  let lastError: unknown;
  for (const [index, ssl] of attempts.entries()) {
    try {
      return await queryVersion(target, ssl);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      const canFallBack =
        index < attempts.length - 1 &&
        (ssl === false || NO_SSL_SUPPORT.test(message));
      if (!canFallBack) {
        break;
      }
    }
  }
  const reason =
    lastError instanceof Error ? lastError.message : "Unknown error.";
  throw new DatabaseToolsError(
    "CONNECTION_FAILED",
    `Could not connect to ${target.host}:${target.port}/${target.databaseName}: ${redactSecrets(
      reason,
      [target.password]
    )}`
  );
};
