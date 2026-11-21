import pg from "pg";
import { DatabaseToolsError } from "../../errors";
import { redactSecrets } from "../../redact";
import type {
  DatabaseTarget,
  QueryLimits,
  QueryResult,
  QueryStatement,
} from "../types";
import { NO_SSL_SUPPORT, type TlsSetting, tlsAttempts } from "./check";

const CONNECT_TIMEOUT_MS = 10_000;
/**
 * The whole call is cut a little after the server's own statement timeout,
 * for a server or network that stops answering. The driver's `query_timeout`
 * is not used: with a `Query` object it swallows the query's error event.
 */
const CALL_GRACE_MS = 5000;

const connect = async (
  target: DatabaseTarget,
  limits: QueryLimits
): Promise<pg.Client> => {
  const attempts = tlsAttempts(target.sslMode);
  let lastError: unknown;
  for (const [index, ssl] of attempts.entries()) {
    const client = new pg.Client({
      application_name: "wizdek-functions",
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      database: target.databaseName,
      host: target.host,
      password: target.password,
      port: target.port,
      ssl: ssl satisfies TlsSetting,
      statement_timeout: limits.timeoutMs,
      user: target.username,
    });
    // A connection that drops later must not crash the process.
    client.on("error", () => undefined);
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      const message = error instanceof Error ? error.message : "";
      const canFallBack =
        index < attempts.length - 1 &&
        (ssl === false || NO_SSL_SUPPORT.test(message));
      if (!canFallBack) {
        break;
      }
    }
  }
  throw lastError;
};

/**
 * Runs one statement and keeps at most `maxRows` rows and about `maxBytes`
 * of them; the rest are read and dropped, so a large result cannot exhaust
 * memory. Parameters always go separately from the text, so a statement is
 * never assembled from values.
 */
const runStatement = (
  client: pg.Client,
  statement: QueryStatement,
  budget: { bytes: number; rows: number }
): Promise<QueryResult> =>
  new Promise((resolve, reject) => {
    const rows: unknown[] = [];
    let truncated = false;
    // Always the extended protocol, which refuses several statements in one
    // text, so a statement's kind is what its first word says. The driver
    // supports `queryMode`; its type definitions do not list it yet.
    const config: pg.QueryConfig & { queryMode: "extended" } = {
      queryMode: "extended",
      text: statement.sql,
      values: [...statement.params],
    };
    const query = new pg.Query(config);
    query.on("row", (row: unknown) => {
      if (truncated) {
        return;
      }
      const size = JSON.stringify(row)?.length ?? 0;
      if (budget.rows <= 0 || budget.bytes - size < 0) {
        truncated = true;
        return;
      }
      budget.rows -= 1;
      budget.bytes -= size;
      rows.push(row);
    });
    query.on("error", reject);
    query.on(
      "end",
      (result: {
        command: string;
        fields?: { dataTypeID: number; name: string }[];
        rowCount: number | null;
      }) => {
        resolve({
          command: result.command,
          fields: (result.fields ?? []).map(({ dataTypeID, name }) => ({
            dataTypeId: dataTypeID,
            name,
          })),
          rowCount: result.rowCount,
          rows,
          truncated,
        });
      }
    );
    client.query(query);
  });

/**
 * Runs statements on a Postgres database: one statement on its own, several
 * inside a transaction that rolls back when one fails.
 */
export const queryPostgres = async (
  target: DatabaseTarget,
  statements: readonly QueryStatement[],
  limits: QueryLimits
): Promise<QueryResult[]> => {
  const secrets = [target.password];
  let client: pg.Client;
  try {
    client = await connect(target, limits);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error.";
    throw new DatabaseToolsError(
      "CONNECTION_FAILED",
      `Could not connect to ${target.host}:${target.port}/${target.databaseName}: ${redactSecrets(reason, secrets)}`
    );
  }
  const budget = { bytes: limits.maxBytes, rows: limits.maxRows };
  const inTransaction = statements.length > 1;
  // Ending the connection fails the statement in progress.
  const deadline = setTimeout(
    () => {
      client.end().catch(() => undefined);
    },
    limits.timeoutMs + CALL_GRACE_MS
  );
  try {
    if (inTransaction) {
      await client.query("BEGIN");
    }
    const results: QueryResult[] = [];
    for (const statement of statements) {
      results.push(await runStatement(client, statement, budget));
    }
    if (inTransaction) {
      await client.query("COMMIT");
    }
    return results;
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    const reason = error instanceof Error ? error.message : "Unknown error.";
    throw new DatabaseToolsError(
      "QUERY_FAILED",
      redactSecrets(reason, secrets)
    );
  } finally {
    clearTimeout(deadline);
    await client.end().catch(() => undefined);
  }
};
