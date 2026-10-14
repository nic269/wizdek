import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const keys = () =>
  createEnv({
    emptyStringAsUndefined: true,
    runtimeEnv: process.env,
    server: {
      /** Where a dump is written before it is verified and uploaded. */
      DATABASE_BACKUP_TMP_DIR: z.string().min(1).optional(),
      /** Directory holding pg_dump and pg_restore; PATH when unset. */
      POSTGRES_CLIENT_BIN_DIR: z.string().min(1).optional(),
    },
    skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  });

/** The executable for a client tool, honouring POSTGRES_CLIENT_BIN_DIR. */
export const postgresToolPath = (tool: "pg_dump" | "pg_restore"): string => {
  const directory = keys().POSTGRES_CLIENT_BIN_DIR;
  return directory ? join(directory, tool) : tool;
};

export const backupTempDirectory = (): string =>
  keys().DATABASE_BACKUP_TMP_DIR ?? join(tmpdir(), "database-backups");
