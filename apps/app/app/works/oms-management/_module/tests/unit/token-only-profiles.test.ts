import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Config, getConfig } from "../../server/config";
import { Profiles } from "../../server/profiles/repository";
import type { ProfileEdit } from "../../server/profiles/schema";
import { ControlStore } from "../../server/storage/control-store";

const mocks = vi.hoisted(() => ({ probe: vi.fn(), verifyBinding: vi.fn() }));
vi.mock("../../server/oms-api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/oms-api/client")>()),
  verifyBinding: mocks.verifyBinding,
}));
vi.mock("../../server/target/clients", () => ({
  clients: () => ({
    lease: async () => ({
      client: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      release: vi.fn(),
    }),
  }),
}));
vi.mock("../../server/target/compatibility", () => ({ probe: mocks.probe }));
const actor = {
  email: "operator@example.test",
  id: "operator",
  name: "Operator",
};
const edit: ProfileEdit = {
  accountIds: [],
  api: {
    origin: "http://127.0.0.1:4012",
    token: { mode: "replace", value: "x".repeat(32) },
  },
  database: {
    host: "127.0.0.1",
    name: "oms",
    password: { mode: "replace", value: "fixture" },
    port: 5432,
    tls: false,
    user: "fixture",
  },
  environment: "custom",
  expectedRevision: 0,
  globalDiagnostics: true,
  id: "custom",
  name: "Custom",
};
let root: string, store: ControlStore, repository: Profiles, config: Config;
beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), "oms-profile-token-"));
  config = {
    ...getConfig(),
    allowLoopback: true,
    controlPath: join(root, "control.sqlite"),
    encryptionKey: Buffer.alloc(32, 7).toString("base64"),
    policy: [
      {
        capabilities: ["read", "profiles:edit"],
        profiles: ["custom"],
        userId: actor.id,
      },
    ],
    profileScopes: { custom: { accountIds: [], globalDiagnostics: true } },
    targetBindings: [],
  };
  store = new ControlStore(config.controlPath, config.encryptionKey);
  repository = new Profiles(store, config);
  mocks.probe.mockResolvedValue({
    checkedAt: new Date().toISOString(),
    databaseIdentity: null,
    features: ["logs"],
  });
});
afterEach(() => {
  store.close();
  rmSync(root, { force: true, recursive: true });
});
describe("API connection save discovery", () => {
  it("saves a v2 URL/token without manual IDs and verifies pairing first", async () => {
    mocks.verifyBinding.mockResolvedValue({
      databaseIdentity: null,
      version: 2,
    });
    await repository.save(actor, edit);
    expect(mocks.verifyBinding).toHaveBeenCalledOnce();
    expect(
      repository.revision({ profileId: "custom", revision: 1 }).connection.api
    ).toEqual({ origin: edit.api?.origin, token: "x".repeat(32) });
  });
  it("persists internally discovered v1 metadata while editor only exposes URL", async () => {
    const databaseIdentity = "2c878880-ec61-43d9-a857-1ee32038a3fd";
    mocks.verifyBinding.mockResolvedValue({
      databaseIdentity,
      deploymentId: "legacy-staging",
      version: 1,
    });
    await repository.save(actor, edit);
    expect(
      repository.revision({ profileId: "custom", revision: 1 }).connection.api
    ).toMatchObject({ databaseIdentity, deploymentId: "legacy-staging" });
    expect(
      repository.editable(actor, { profileId: "custom", revision: 1 }).api
    ).toEqual({ origin: edit.api?.origin });
  });
  it("never sends the old token to a changed API URL through a forged keep request", async () => {
    mocks.verifyBinding.mockResolvedValue({
      databaseIdentity: null,
      version: 2,
    });
    await repository.save(actor, edit);
    mocks.verifyBinding.mockClear();
    await expect(
      repository.save(actor, {
        ...edit,
        api: { origin: "http://127.0.0.1:4999", token: { mode: "keep" } },
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ code: "api_token_required" });
    expect(mocks.verifyBinding).not.toHaveBeenCalled();
    expect(repository.row("custom")?.revision).toBe(1);
  });
  it("allows an explicit replacement token for a changed URL", async () => {
    mocks.verifyBinding.mockResolvedValue({
      databaseIdentity: null,
      version: 2,
    });
    await repository.save(actor, edit);
    await repository.save(actor, {
      ...edit,
      api: {
        origin: "http://127.0.0.1:4999",
        token: { mode: "replace", value: "y".repeat(32) },
      },
      expectedRevision: 1,
    });
    expect(
      repository.revision({ profileId: "custom", revision: 2 }).connection.api
    ).toEqual({ origin: "http://127.0.0.1:4999", token: "y".repeat(32) });
  });
  it("does not persist a profile when the API database does not match", async () => {
    mocks.verifyBinding.mockRejectedValue(new Error("different database"));
    await expect(repository.save(actor, edit)).rejects.toThrow(
      "different database"
    );
    expect(repository.row("custom")).toBeUndefined();
  });
});
