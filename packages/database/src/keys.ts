import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const keys = () =>
  createEnv({
    emptyStringAsUndefined: true,
    runtimeEnv: process.env,
    server: {
      DATABASE_URL: z.string().url(),
    },
    skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  });
