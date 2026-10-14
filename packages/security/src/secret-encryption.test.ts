import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secret-encryption";

const KEY = "unit-test-secret-of-at-least-32-chars";

describe("secret encryption", () => {
  it("round-trips a secret without exposing the plaintext", () => {
    const encrypted = encryptSecret("shpat_test_token", KEY);

    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(encrypted).not.toContain("shpat_test_token");
    expect(decryptSecret(encrypted, KEY)).toBe("shpat_test_token");
  });

  it("produces a different payload for each encryption", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });

  it("rejects a tampered ciphertext or auth tag", () => {
    const [version, iv, tag, data] = encryptSecret(
      "shpat_test_token",
      KEY
    ).split(".") as [string, string, string, string];
    const flip = (value: string) =>
      (value.startsWith("A") ? "B" : "A") + value.slice(1);

    expect(() =>
      decryptSecret([version, iv, tag, flip(data)].join("."), KEY)
    ).toThrow();
    expect(() =>
      decryptSecret([version, iv, flip(tag), data].join("."), KEY)
    ).toThrow();
  });

  it("rejects the wrong key, an unknown version and malformed payloads", () => {
    const encrypted = encryptSecret("shpat_test_token", KEY);

    expect(() => decryptSecret(encrypted, `${KEY}-other`)).toThrow();
    expect(() => decryptSecret(encrypted.replace("v1.", "v2."), KEY)).toThrow(
      "Invalid encrypted secret payload."
    );
    expect(() => decryptSecret("not-a-payload", KEY)).toThrow(
      "Invalid encrypted secret payload."
    );
  });

  it("decrypts a payload written by an earlier release", () => {
    // Stored tokens and URLs must keep decrypting; a format change breaks them.
    const stored =
      "v1.lDeJiAsYJ0X2JLu0.klDxEAlDdsT0SkMyy-J9mQ.osig4QKLeezIVZwByT9iNI2KISE";

    expect(decryptSecret(stored, KEY)).toBe("shpat_compat_fixture");
  });

  it("refuses to encrypt an empty secret", () => {
    expect(() => encryptSecret("", KEY)).toThrow();
  });
});
