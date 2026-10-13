import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

export const keys = () =>
  createEnv({
    emptyStringAsUndefined: true,
    runtimeEnv: process.env,
    server: {
      /** Reused from the application; pg-boss keeps its own schema in it. */
      DATABASE_URL: z.string().url(),
      /** `local` keeps jobs in memory; `pgboss` stores them in Postgres. */
      JOBS_PROVIDER: z.enum(["local", "pgboss"]).default("local"),
      /** Set to false on a process that should enqueue jobs but not run them. */
      JOBS_WORKER_ENABLED: booleanFlag,
    },
    skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  });
