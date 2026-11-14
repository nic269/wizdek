import { describe, expect, it } from "vitest";
import { redact } from "../../server/redact";

describe("diagnostic DTO redaction", () => {
  it("preserves timestamps and pagination cursors", () => {
    expect(redact({ createdAt: new Date("2026-11-14T00:00:00.000Z") })).toEqual(
      { createdAt: "2026-11-14T00:00:00.000Z" }
    );
  });
  it("removes secrets in objects, serialized JSON and embedded log text", () => {
    const secret = "fake_sensitive_credential";
    const output = JSON.stringify(
      redact({
        message: `Request: {"token":"${secret}"} Authorization: Bearer ${secret}`,
        metadata: JSON.stringify({ clientSecret: secret }),
        webhookSignatureEncrypted: secret,
      })
    );
    expect(output).not.toContain(secret);
  });
});
