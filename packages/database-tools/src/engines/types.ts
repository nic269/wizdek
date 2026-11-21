import type { Prisma } from "@repo/database";

export type DatabaseEngine =
  Prisma.DatabaseConnectionGetPayload<object>["engine"];

/** Where and how to connect, parsed from a connection URL. */
export interface DatabaseTarget {
  databaseName: string;
  host: string;
  password: string;
  port: number;
  sslMode?: string;
  username: string;
}

export interface ServerVersion {
  major: number;
  text: string;
}

export interface ToolVersion {
  major: number;
  text: string;
}

/** One parameterized statement. */
export interface QueryStatement {
  params: readonly unknown[];
  sql: string;
}

export interface QueryLimits {
  /** Bytes of rows kept across all statements, about. */
  maxBytes: number;
  /** Rows kept across all statements. */
  maxRows: number;
  /** The server cancels a statement that runs longer; the whole call ends soon after. */
  timeoutMs: number;
}

export interface QueryResult {
  /** e.g. SELECT, INSERT, UPDATE. */
  command: string;
  fields: { dataTypeId: number; name: string }[];
  /** Rows returned or affected, as the server reports it. */
  rowCount: number | null;
  rows: unknown[];
  /** True when rows were dropped to stay within the limits. */
  truncated: boolean;
}

/**
 * Everything the toolkit needs to know about one database engine. Adding an
 * engine means writing one of these; nothing else depends on the engine.
 */
export interface DatabaseEngineAdapter {
  /** Connects, reads the server version, disconnects. */
  check(target: DatabaseTarget): Promise<ServerVersion>;
  contentType: string;
  /** Writes a backup of the whole database to `outputPath`. */
  dump(input: {
    outputPath: string;
    signal: AbortSignal;
    target: DatabaseTarget;
  }): Promise<void>;
  engine: DatabaseEngine;
  fileExtension: string;
  /** Human-readable engine name for messages. */
  label: string;
  parseUrl(url: string): DatabaseTarget;
  /**
   * Runs parameterized statements, several inside one transaction, for a
   * function's built-in helpers.
   */
  query(
    target: DatabaseTarget,
    statements: readonly QueryStatement[],
    limits: QueryLimits
  ): Promise<QueryResult[]>;
  /** URL schemes this adapter owns, without the trailing colon. */
  schemes: readonly string[];
  /** The version of the dump tool that `dump` runs. */
  toolVersion(signal?: AbortSignal): Promise<ToolVersion>;
  /** Fails unless the file at `path` is a readable backup. */
  verify(input: { path: string; signal: AbortSignal }): Promise<void>;
}
