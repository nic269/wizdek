import { describe, expect, it } from "vitest";
import {
  authFeatureConfig,
  authMailRequired,
  featureConfig,
  isAuthMailRequired,
} from "./features";

describe("auth feature config", () => {
  it("requires real mail delivery for enabled auth workflows", () => {
    expect(authFeatureConfig).toEqual({
      organizationInvitations: true,
      passwordReset: true,
      requireEmailVerification: true,
    });
    expect(authMailRequired).toBe(true);
    expect(featureConfig.jobs).toBe(false);
    expect(featureConfig).not.toHaveProperty("docs");
    expect(featureConfig).not.toHaveProperty("email");
    expect(featureConfig).not.toHaveProperty("organizations");
  });

  it("does not require mail when every auth delivery workflow is disabled", () => {
    expect(
      isAuthMailRequired({
        organizationInvitations: false,
        passwordReset: false,
        requireEmailVerification: false,
      })
    ).toBe(false);
  });
});
