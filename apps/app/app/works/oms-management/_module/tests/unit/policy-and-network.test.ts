import { describe, expect, it } from "vitest";
import type { Config } from "../../server/config";
import {
  capabilitiesFor,
  requireCapability,
} from "../../server/identity/access-policy";
import {
  forbiddenAddress,
  validateNetwork,
} from "../../server/profiles/network-policy";
import type { Connection } from "../../server/profiles/schema";
import { assertProfileScope } from "../../server/profiles/scope-ceiling";

const actor = {
  email: "operator@example.com",
  id: "operator-1",
  name: "Operator",
};
const config = {
  allowedUsers: new Set([actor.id]),
  allowLoopback: true,
  apiOrigins: new Set(["http://127.0.0.1:4011"]),
  backupEvidence: {},
  controlPath: ".data/test/control.sqlite",
  dbHosts: new Set(["127.0.0.1"]),
  dbPorts: new Set([5432]),
  encryptionKey: Buffer.alloc(32).toString("base64"),
  identityOrigin: "http://127.0.0.1:3002",
  policy: [
    {
      capabilities: ["profiles:edit"],
      profiles: ["staging"],
      userId: actor.id,
    },
  ],
  poolLimit: 1,
  profileScopes: {
    custom: { accountIds: ["account-1"], globalDiagnostics: false },
    lab: {
      accountIds: ["account-1", "account-2"],
      globalDiagnostics: true,
    },
    production: { accountIds: ["account-1"], globalDiagnostics: false },
  },
  publicOrigin: "http://127.0.0.1:4010",
  targetBindings: [],
} as Config;

const connection: Connection = {
  accountIds: [],
  api: null,
  database: {
    host: "127.0.0.1",
    name: "oms",
    password: "test-only",
    port: 5432,
    tls: false,
    user: "diagnostic",
  },
  globalDiagnostics: false,
};

describe("access policy", () => {
  it("requires an explicit custom grant for a connection named oms-staging", () => {
    const profile = { id: "oms-staging", safetyClass: "custom" as const };
    expect(() =>
      requireCapability(actor, profile, "profiles:edit", config)
    ).toThrow("does not allow managing this custom connection");
    const customConfig: Config = {
      ...config,
      policy: [
        ...config.policy,
        {
          capabilities: ["read", "profiles:edit"],
          profiles: ["custom"],
          userId: actor.id,
        },
      ],
    };
    expect(() =>
      requireCapability(actor, profile, "profiles:edit", customConfig)
    ).not.toThrow();
    expect(
      capabilitiesFor(
        actor,
        { ...profile, safetyClass: "production" },
        customConfig
      )
    ).toEqual(["read"]);
  });
  it("keeps elevated capabilities scoped to the matching profile class", () => {
    expect(
      capabilitiesFor(actor, { id: "staging", safetyClass: "staging" }, config)
    ).toEqual(["read", "profiles:edit"]);
    expect(
      capabilitiesFor(
        actor,
        { id: "production", safetyClass: "production" },
        config
      )
    ).toEqual(["read"]);
    expect(() =>
      requireCapability(
        actor,
        { id: "production", safetyClass: "production" },
        "profiles:edit",
        config
      )
    ).toThrowError(expect.objectContaining({ code: "forbidden", status: 403 }));
  });

  it("denies users absent from both the allowlist and explicit policy", () => {
    const stranger = {
      email: "stranger@example.com",
      id: "stranger",
      name: "Stranger",
    };
    expect(
      capabilitiesFor(
        stranger,
        { id: "staging", safetyClass: "staging" },
        config
      )
    ).toEqual([]);
  });

  it("does not elevate a production-classified alias through a named staging rule", () => {
    expect(
      capabilitiesFor(
        actor,
        { id: "staging", safetyClass: "production" },
        config
      )
    ).toEqual(["read"]);
  });
});

describe("profile scope ceiling", () => {
  it("intersects a broad named selector with the mandatory production ceiling", () => {
    expect(() =>
      assertProfileScope(
        {
          ...connection,
          accountIds: ["account-2"],
          globalDiagnostics: true,
        },
        "lab",
        "production",
        config
      )
    ).toThrowError(
      expect.objectContaining({ code: "scope_denied", status: 403 })
    );
  });
});

describe("network policy", () => {
  it("accepts operator-supplied hosts and ports when optional allowlists are empty", async () => {
    await expect(
      validateNetwork(
        { ...connection, database: { ...connection.database, port: 5433 } },
        { ...config, dbHosts: new Set(), dbPorts: new Set() }
      )
    ).resolves.toMatchObject({ db: { address: "127.0.0.1" } });
  });
  it.each([
    ["127.0.0.1", false, true],
    ["127.0.0.1", true, false],
    ["169.254.169.254", true, true],
    ["::ffff:127.0.0.1", true, true],
    ["2001:db8::1", false, false],
    ["8.8.8.8", false, false],
  ])("classifies %s with allowLoopback=%s", (address, allowLoopback, expected) => {
    expect(forbiddenAddress(address, allowLoopback)).toBe(expected);
  });

  it("accepts an explicitly allowlisted loopback database in local mode", async () => {
    await expect(validateNetwork(connection, config)).resolves.toEqual({
      api: null,
      db: { address: "127.0.0.1", family: 4 },
    });
  });

  it("rejects a database host outside the operator allowlist", async () => {
    await expect(
      validateNetwork(
        {
          ...connection,
          database: { ...connection.database, host: "8.8.8.8" },
        },
        config
      )
    ).rejects.toMatchObject({ code: "host_denied", status: 403 });
  });

  it("rejects an API origin outside the operator allowlist", async () => {
    await expect(
      validateNetwork(
        {
          ...connection,
          api: {
            databaseIdentity: "2c878880-ec61-43d9-a857-1ee32038a3fd",
            deploymentId: "test",
            origin: "http://127.0.0.1:4012",
            token: "test-only",
          },
        },
        config
      )
    ).rejects.toMatchObject({ code: "origin_denied", status: 403 });
  });
});
