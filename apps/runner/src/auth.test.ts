import { describe, expect, it } from "vitest";
import { isAuthorized } from "./auth";

const TOKEN = "a-long-enough-token-for-the-runner-agent";

describe("isAuthorized", () => {
  it("accepts the token as a bearer credential", () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("refuses a missing header, another scheme and a wrong token", () => {
    expect(isAuthorized(undefined, TOKEN)).toBe(false);
    expect(isAuthorized(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    expect(isAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(isAuthorized("Bearer ", TOKEN)).toBe(false);
  });
});
