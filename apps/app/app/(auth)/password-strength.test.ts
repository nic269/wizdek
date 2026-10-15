import { describe, expect, it } from "vitest";
import { passwordStrength } from "./password-strength";

describe("password strength", () => {
  it("scores anything under the minimum length as too short", () => {
    expect(passwordStrength("")).toEqual({ label: "Too short", score: 0 });
    expect(passwordStrength("Ab1!xyz")).toEqual({
      label: "Too short",
      score: 0,
    });
  });

  it("adds a point for length, letters with digits, and case or symbols", () => {
    expect(passwordStrength("abcdefgh").score).toBe(1);
    expect(passwordStrength("abcdefg1").score).toBe(2);
    expect(passwordStrength("Abcdefg1").score).toBe(3);
    expect(passwordStrength("Password123!")).toEqual({
      label: "Strong",
      score: 4,
    });
  });
});
