import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { keys } from "./keys";

const ALGORITHM = "aes-256-gcm";
const FORMAT_VERSION = "v1";

const deriveKey = (secret: string): Buffer =>
  createHash("sha256").update(secret).digest();

const resolveSecret = (secret?: string): string =>
  secret ?? keys().SHOPIFY_TOKEN_ENCRYPTION_KEY;

export const encryptSecret = (plainText: string, secret?: string): string => {
  if (!plainText) {
    throw new Error("Cannot encrypt an empty secret.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    ALGORITHM,
    deriveKey(resolveSecret(secret)),
    iv
  );
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const parts = [iv, cipher.getAuthTag(), encrypted].map((part) =>
    part.toString("base64url")
  );
  return [FORMAT_VERSION, ...parts].join(".");
};

export const decryptSecret = (payload: string, secret?: string): string => {
  const [version, iv, authTag, encrypted, ...rest] = payload.split(".");
  if (
    version !== FORMAT_VERSION ||
    !iv ||
    !authTag ||
    !encrypted ||
    rest.length > 0
  ) {
    throw new Error("Invalid encrypted secret payload.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    deriveKey(resolveSecret(secret)),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};
