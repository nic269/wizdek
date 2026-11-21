import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    /** An install whose packages take more than this is discarded. */
    RUNNER_DEPS_MAX_MB: z.coerce.number().int().positive().default(500),
    /**
     * Installs are refused below this much free disk; unused packages are
     * removed until twice this much is free.
     */
    RUNNER_DEPS_MIN_FREE_GB: z.coerce.number().positive().default(4),
    /** Resolver given to sandbox containers, so LAN names never resolve. */
    RUNNER_DNS: z.string().min(1).default("1.1.1.1"),
    RUNNER_HOST: z.string().min(1).default("127.0.0.1"),
    /** Running containers' memory limits may add up to this much. */
    RUNNER_MEMORY_BUDGET_MB: z.coerce.number().int().positive().default(2560),
    RUNNER_PORT: z.coerce.number().int().positive().default(3003),
    /** Holds one directory per runtime image; the package's own by default. */
    RUNNER_RUNTIMES_DIR: z
      .string()
      .min(1)
      .default(resolve(process.cwd(), "runtimes")),
    /** Docker network that sandbox containers join. */
    RUNNER_SANDBOX_NETWORK: z.string().min(1).default("bridge"),
    RUNNER_TLS_CERT: z.string().min(1).optional(),
    RUNNER_TLS_KEY: z.string().min(1).optional(),
    /** Bearer token the API presents. The agent stays idle without it. */
    RUNNER_TOKEN: z.string().min(32).optional(),
    /**
     * Where run files are written. The Docker daemon must see this path as
     * the agent does, so mount it at the same path when the agent is itself
     * in a container.
     */
    RUNNER_WORK_DIR: z.string().min(1).default(join(tmpdir(), "fn-runner")),
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
