import { getJobProviderStatus } from "@repo/jobs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertApiProviderConfiguration,
  getApiProviderReadiness,
} from "./health";

vi.mock("@repo/database", () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock("@repo/jobs", () => ({ getJobProviderStatus: vi.fn() }));
vi.mock("@repo/mail", () => ({
  assertMailProviderConfiguration: vi.fn(),
  getMailProviderStatus: () => ({
    configured: true,
    mode: "production",
    provider: "resend",
    state: "configured",
  }),
}));
vi.mock("@repo/storage", () => ({
  assertStorageProviderConfiguration: vi.fn(),
  getStorageProviderStatus: () => ({
    configured: true,
    mode: "local",
    provider: "local",
    state: "configured",
  }),
}));

const LOCAL = {
  configured: true,
  mode: "ephemeral",
  provider: "local",
  state: "configured",
} as const;
const DURABLE = {
  configured: true,
  mode: "durable",
  provider: "pgboss",
  state: "configured",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("job provider readiness", () => {
  it("accepts in-memory jobs outside production", () => {
    vi.mocked(getJobProviderStatus).mockReturnValue(LOCAL);

    expect(getApiProviderReadiness().jobs).toMatchObject({
      healthy: true,
      mode: "ephemeral",
    });
    expect(() => assertApiProviderConfiguration()).not.toThrow();
  });

  it("refuses to start in production with in-memory jobs", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(getJobProviderStatus).mockReturnValue(LOCAL);

    expect(getApiProviderReadiness().jobs).toMatchObject({
      healthy: false,
      state: "misconfigured",
    });
    expect(() => assertApiProviderConfiguration()).toThrow(
      "Required providers are not ready: jobs."
    );
  });

  it("starts in production with the durable provider", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(getJobProviderStatus).mockReturnValue(DURABLE);

    expect(getApiProviderReadiness().jobs).toMatchObject({
      healthy: true,
      mode: "durable",
      provider: "pgboss",
    });
    expect(() => assertApiProviderConfiguration()).not.toThrow();
  });
});
