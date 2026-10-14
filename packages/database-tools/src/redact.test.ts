import { describe, expect, it } from "vitest";
import { redactSecrets, secretsOf } from "./redact";

describe("redactSecrets", () => {
  it("removes a URL whole, and its password wherever else it appears", () => {
    const url = "postgresql://app:s3cr%40t@db/orders";
    const text = `failed for ${url}; password s3cr@t rejected (s3cr%40t)`;

    const redacted = redactSecrets(text, secretsOf(url, "s3cr@t"));

    expect(redacted).not.toContain("s3cr");
    expect(redacted).toBe(
      "failed for [redacted]; password [redacted] rejected ([redacted])"
    );
  });

  it("masks the credentials of any URL even when the secret is not known", () => {
    expect(
      redactSecrets("could not reach mysql://root:hunter2@10.0.0.4/app")
    ).toBe("could not reach mysql://[redacted]@10.0.0.4/app");
  });

  it("ignores empty secrets", () => {
    expect(redactSecrets("nothing to hide", ["", ""])).toBe("nothing to hide");
  });
});
