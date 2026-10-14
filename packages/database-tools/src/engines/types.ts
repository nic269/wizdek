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
  /** URL schemes this adapter owns, without the trailing colon. */
  schemes: readonly string[];
  /** The version of the dump tool that `dump` runs. */
  toolVersion(signal?: AbortSignal): Promise<ToolVersion>;
  /** Fails unless the file at `path` is a readable backup. */
  verify(input: { path: string; signal: AbortSignal }): Promise<void>;
}
