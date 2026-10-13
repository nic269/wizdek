import { keys as auth } from "@repo/auth/keys";
import { keys as database } from "@repo/database/keys";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  extends: [auth(), database()],
  runtimeEnv: process.env,
  server: {
    NEXT_PUBLIC_API_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
