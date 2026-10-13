import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const keys = () =>
  createEnv({
    emptyStringAsUndefined: true,
    runtimeEnv: process.env,
    server: {
      LOCAL_STORAGE_DIR: z.string().min(1).optional(),
      S3_ACCESS_KEY_ID: z.string().min(1).optional(),
      S3_BUCKET: z.string().min(1).optional(),
      S3_ENDPOINT: z.string().url().optional(),
      S3_FORCE_PATH_STYLE: z.coerce.boolean().optional(),
      S3_REGION: z.string().min(1).optional(),
      S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
      STORAGE_PROVIDER: z.enum(["local", "memory", "s3", "r2"]).optional(),
    },
    skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  });
