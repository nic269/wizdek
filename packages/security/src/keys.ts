import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const keys = () =>
  createEnv({
    emptyStringAsUndefined: true,
    runtimeEnv: process.env,
    server: {
      /**
       * Encrypts every stored secret: Shopify tokens and client secrets, and
       * database connection URLs. The name predates the database tools.
       */
      SHOPIFY_TOKEN_ENCRYPTION_KEY: z.string().min(32),
    },
    skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  });
