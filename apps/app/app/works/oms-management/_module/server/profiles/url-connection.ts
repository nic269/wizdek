import { z } from "zod";
import { safetySchema } from "../../lib/contracts";
import { ManagementError } from "../errors";
import { apiOriginSchema } from "./schema";

export const urlConnectionSchema = z
  .object({
    api: z
      .object({
        origin: apiOriginSchema,
        token: z.string().min(32).max(4096),
      })
      .strict()
      .nullable()
      .optional(),
    environment: safetySchema,
    name: z.string().trim().min(1).max(80),
    url: z.string().trim().min(1).max(4096),
  })
  .strict();

export function databaseFromUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    const name = decodeURIComponent(url.pathname.slice(1));
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const mode = url.searchParams.get("sslmode") ?? "require";
    if (
      !(
        ["postgres:", "postgresql:"].includes(url.protocol) &&
        url.hostname &&
        user &&
        name
      ) ||
      name.includes("/") ||
      ![
        "disable",
        "allow",
        "prefer",
        "require",
        "verify-ca",
        "verify-full",
      ].includes(mode)
    ) {
      throw new Error("invalid");
    }
    return {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      name,
      password: password
        ? { mode: "replace" as const, value: password }
        : { mode: "clear" as const },
      port: Number(url.port || 5432),
      tls: mode !== "disable",
      user,
      verifyTls: mode === "verify-ca" || mode === "verify-full",
    };
  } catch {
    throw new ManagementError(
      "invalid_database_url",
      "Enter a PostgreSQL URL: postgresql://user:password@host:5432/database.",
      400
    );
  }
}

export function connectionFailure(error: unknown): never {
  if (error instanceof ManagementError || error instanceof z.ZodError) {
    throw error;
  }
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const messages: Record<string, string> = {
    "3D000": "The database name in the URL does not exist.",
    "28P01":
      "Database login failed. Check the user name and password in the URL.",
    "28000":
      "The database rejected this login. Check its access rules and SSL settings.",
    "42501":
      "This DB user cannot read the required OMS tables. Check its database permissions.",
    ECONNREFUSED:
      "Database connection was refused. Check the host, port and network access.",
    ENOTFOUND: "Database host was not found. Check the URL hostname.",
    ETIMEDOUT:
      "Database connection timed out. Check VPN, firewall and database network access.",
    SELF_SIGNED_CERT_IN_CHAIN:
      "The database certificate is not trusted. Configure its CA or use sslmode=require as supported by your database.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:
      "The database certificate is not trusted. Configure its CA or use sslmode=require as supported by your database.",
  };
  throw new ManagementError(
    "database_connection_failed",
    messages[code] ??
      "Could not connect to this database. Check the URL, SSL settings and network access.",
    400
  );
}
