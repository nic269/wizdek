import { describe, expect, it } from "vitest";
import { safeAuthCallbackUrl } from "./callback-url";

describe("safe auth callback URL", () => {
  it("keeps canonical same-origin relative paths", () => {
    expect(safeAuthCallbackUrl("/invite/token?step=1#accept")).toBe(
      "/invite/token?step=1#accept"
    );
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%2fevil.example",
    "/%5cevil.example",
    "/%0aevil.example",
  ])("rejects unsafe callback %s", (value) => {
    expect(safeAuthCallbackUrl(value)).toBe("/dashboard");
  });
});
