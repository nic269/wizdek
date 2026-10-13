import { describe, expect, it, vi } from "vitest";
import {
  createLocalJobProvider,
  createOrganizationJobScopeKey,
  GLOBAL_JOB_SCOPE_KEY,
  getJobProviderStatus,
} from ".";

describe("local job provider", () => {
  it("reports that local job execution is ephemeral", () => {
    expect(getJobProviderStatus()).toEqual({
      configured: true,
      mode: "ephemeral",
      provider: "local",
      state: "configured",
    });
  });

  it("runs registered jobs and records completion", async () => {
    const provider = createLocalJobProvider();
    const handler = vi.fn(async () => undefined);
    provider.register({ handler, name: "email.send" });

    const { runId } = await provider.enqueue({
      name: "email.send",
      payload: { email: "user@example.com" },
    });
    await provider.waitUntilIdle();

    expect(handler).toHaveBeenCalledWith({ email: "user@example.com" });
    await expect(provider.getRun(runId)).resolves.toMatchObject({
      attempts: 1,
      scopeKey: GLOBAL_JOB_SCOPE_KEY,
      status: "completed",
    });
  });

  it("deduplicates queued work by idempotency key", async () => {
    const provider = createLocalJobProvider();
    const handler = vi.fn(async () => undefined);
    provider.register({ handler, name: "report.build" });

    const first = await provider.enqueue({
      idempotencyKey: "daily",
      name: "report.build",
      payload: {},
    });
    const second = await provider.enqueue({
      idempotencyKey: "daily",
      name: "report.build",
      payload: {},
    });
    await provider.waitUntilIdle();

    expect(second.runId).toBe(first.runId);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries failed jobs and records final failure", async () => {
    const provider = createLocalJobProvider();
    const handler = vi.fn(() =>
      Promise.reject(new Error("provider unavailable"))
    );
    provider.register({
      handler,
      name: "sync.provider",
      retry: { attempts: 2, delayMs: 0 },
    });

    const { runId } = await provider.enqueue({
      name: "sync.provider",
      payload: {},
    });
    await provider.waitUntilIdle();

    expect(handler).toHaveBeenCalledTimes(2);
    await expect(provider.getRun(runId)).resolves.toMatchObject({
      attempts: 2,
      error: "provider unavailable",
      status: "failed",
    });
  });

  it("scopes idempotency to an organization", async () => {
    const provider = createLocalJobProvider();
    const handler = vi.fn(async () => undefined);
    provider.register({ handler, name: "report.build" });

    const first = await provider.enqueue({
      idempotencyKey: "daily",
      name: "report.build",
      payload: {},
      scopeKey: createOrganizationJobScopeKey("org-1"),
    });
    const second = await provider.enqueue({
      idempotencyKey: "daily",
      name: "report.build",
      payload: {},
      scopeKey: createOrganizationJobScopeKey("org-2"),
    });
    await provider.waitUntilIdle();

    expect(second.runId).not.toBe(first.runId);
    expect(handler).toHaveBeenCalledTimes(2);
    await expect(provider.listRuns()).resolves.toHaveLength(2);
  });

  it("creates canonical organization scope keys", () => {
    expect(createOrganizationJobScopeKey(" org-1 ")).toBe("organization:org-1");
    expect(() => createOrganizationJobScopeKey("  ")).toThrow(
      "Organization ID is required"
    );
  });

  it("rejects an explicitly empty scope key", async () => {
    const provider = createLocalJobProvider();
    provider.register({ handler: vi.fn(async () => undefined), name: "sync" });

    await expect(
      provider.enqueue({ name: "sync", payload: {}, scopeKey: "  " })
    ).rejects.toThrow("Job scope key cannot be empty");
  });
});
