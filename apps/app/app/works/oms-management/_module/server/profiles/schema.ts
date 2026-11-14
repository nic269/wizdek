import { z } from "zod";
export const apiOriginSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  }, "Enter an API origin without a path, query or credentials.")
  .transform((value) => new URL(value).origin);
export const connectionSchema = z
  .object({
    // Global workflow diagnostics are explicit; operational commands additionally scope accounts.
    accountIds: z.array(z.string().min(1).max(128)).max(100),
    api: z
      .object({
        databaseIdentity: z.string().uuid().optional(),
        deploymentId: z.string().min(1).max(128).optional(),
        origin: apiOriginSchema,
        token: z.string().min(1).max(4096),
      })
      .strict()
      .nullable(),
    database: z
      .object({
        host: z
          .string()
          .min(1)
          .max(253)
          .regex(/^[a-zA-Z0-9.:-]+$/),
        name: z.string().min(1).max(128),
        password: z.string().max(4096),
        port: z.number().int().min(1).max(65_535).default(5432),
        tls: z.boolean().default(true),
        user: z.string().min(1).max(128),
        verifyTls: z.boolean().optional(),
      })
      .strict(),
    globalDiagnostics: z.boolean().default(false),
  })
  .strict();
export type Connection = z.infer<typeof connectionSchema>;
export const secretChange = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("keep") }).strict(),
  z
    .object({ mode: z.literal("replace"), value: z.string().min(1).max(4096) })
    .strict(),
  z.object({ mode: z.literal("clear") }).strict(),
]);
export const editSchema = z
  .object({
    accountIds: connectionSchema.shape.accountIds,
    api: z
      .object({
        databaseIdentity: z.string().uuid().optional(),
        deploymentId: z.string().min(1).max(128).optional(),
        origin: apiOriginSchema,
        token: secretChange,
      })
      .nullable(),
    database: connectionSchema.shape.database
      .omit({ password: true })
      .extend({ password: secretChange }),
    environment: z.enum(["staging", "production", "custom"]).optional(),
    expectedRevision: z.number().int().nonnegative(),
    globalDiagnostics: z.boolean(),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export type ProfileEdit = z.infer<typeof editSchema>;
