import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { invariant, ManagementError } from "../errors";
import type { Connection } from "../profiles/schema";
import { directResources } from "./direct-config";

function key(connection: Connection) {
  const secret = directResources(connection).encryptionKey;
  invariant(
    secret,
    "encryption_key_required",
    "Configure the OMS encryption key for this database before managing secrets.",
    409
  );
  return createHash("sha256").update(secret).digest();
}
// Compatible with OMS token-encryption; credentials stay server-side and DB-scoped.
export function encryptOmsSecret(connection: Connection, plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(connection), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}
export function decryptOmsSecret(connection: Connection, ciphertext: string) {
  const secret = key(connection);
  try {
    const [iv, tag, value] = ciphertext.split(".");
    invariant(
      iv && tag && value,
      "secret_invalid",
      "The stored secret could not be decrypted.",
      409
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      secret,
      Buffer.from(iv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(value, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ManagementError(
      "secret_invalid",
      "The stored secret could not be decrypted with this database's configured key.",
      409
    );
  }
}
