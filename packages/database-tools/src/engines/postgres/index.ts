import { DatabaseToolsError } from "../../errors";
import { postgresToolPath } from "../../keys";
import { secretsOf } from "../../redact";
import { runTool } from "../run-tool";
import type { DatabaseEngineAdapter, ToolVersion } from "../types";
import { checkPostgres } from "./check";
import { libpqEnvironment, pgDumpArguments } from "./env";
import { POSTGRES_SCHEMES, parsePostgresUrl } from "./url";

// e.g. "pg_dump (PostgreSQL) 18.6" or "pg_dump (PostgreSQL) 16.4 (Homebrew)".
const TOOL_VERSION = /\(PostgreSQL\)\s+(\d+)(?:\.\d+)?/;

export const parseToolVersion = (output: string): ToolVersion => {
  const text = output.trim();
  const match = TOOL_VERSION.exec(text);
  if (!match?.[1]) {
    throw new DatabaseToolsError(
      "TOOL_FAILED",
      `Could not read the pg_dump version from "${text}".`
    );
  }
  return { major: Number(match[1]), text };
};

export const postgresAdapter: DatabaseEngineAdapter = {
  check: checkPostgres,
  contentType: "application/octet-stream",
  async dump({ outputPath, signal, target }) {
    await runTool({
      args: pgDumpArguments(outputPath),
      command: postgresToolPath("pg_dump"),
      env: libpqEnvironment(target),
      secrets: secretsOf("", target.password),
      signal,
    });
  },
  engine: "POSTGRESQL",
  fileExtension: "dump",
  label: "PostgreSQL",
  parseUrl: parsePostgresUrl,
  schemes: POSTGRES_SCHEMES,
  async toolVersion(signal) {
    const { stdoutTail } = await runTool({
      args: ["--version"],
      command: postgresToolPath("pg_dump"),
      env: libpqEnvironment(),
      ...(signal ? { signal } : {}),
    });
    return parseToolVersion(stdoutTail);
  },
  async verify({ path, signal }) {
    const { stdoutBytes } = await runTool({
      args: ["--list", path],
      command: postgresToolPath("pg_restore"),
      env: libpqEnvironment(),
      signal,
    });
    if (stdoutBytes === 0) {
      throw new DatabaseToolsError(
        "TOOL_FAILED",
        "pg_restore could not list the contents of the backup."
      );
    }
  },
};
