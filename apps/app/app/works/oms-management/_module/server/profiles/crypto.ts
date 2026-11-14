import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ManagementError } from "../errors";
export class Vault {
  private readonly key: Buffer;
  constructor(encoded: string) {
    this.key = Buffer.from(encoded, "base64");
    if (this.key.length !== 32) {
      throw new ManagementError(
        "vault_key_invalid",
        "A 32-byte profile encryption key is required.",
        503
      );
    }
  }
  seal(value: unknown, purpose: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), data]
      .map((v) => v.toString("base64"))
      .join(".");
  }
  open<T>(encoded: string, purpose: string): T {
    try {
      const [iv, tag, data] = encoded
        .split(".")
        .map((v) => Buffer.from(v, "base64"));
      if (!(iv && tag && data)) {
        throw new Error("Vault payload is incomplete.");
      }
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(tag);
      return JSON.parse(
        Buffer.concat([decipher.update(data), decipher.final()]).toString(
          "utf8"
        )
      ) as T;
    } catch {
      throw new ManagementError(
        "vault_unavailable",
        "The profile vault cannot be unlocked.",
        503
      );
    }
  }
}
