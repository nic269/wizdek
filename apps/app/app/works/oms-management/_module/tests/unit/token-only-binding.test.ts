import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "../../server/config";
import {
  bridgeRequest,
  databaseFingerprint,
  verifyBinding,
} from "../../server/oms-api/client";
import { readPreset } from "../../server/profiles/presets";
import {
  type Connection,
  connectionSchema,
} from "../../server/profiles/schema";
import { urlConnectionSchema } from "../../server/profiles/url-connection";

const token = "x".repeat(32);
const marker = "2c878880-ec61-43d9-a857-1ee32038a3fd";
const connection: Connection = {
  accountIds: [],
  api: null,
  database: {
    host: "127.0.0.1",
    name: "oms",
    password: "fixture",
    port: 5432,
    tls: false,
    user: "fixture",
  },
  globalDiagnostics: true,
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (service) =>
          new Promise<void>((resolve, reject) =>
            service.close((error) => (error ? reject(error) : resolve()))
          )
      )
  );
});
async function server(identity: unknown, status = 200) {
  const requests: IncomingMessage[] = [];
  const service = createServer((req, res) => {
    requests.push(req);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(identity));
  });
  servers.push(service);
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  const api = {
    origin: `http://127.0.0.1:${(service.address() as AddressInfo).port}`,
    token,
  };
  return { connection: { ...connection, api }, requests };
}
const config = () => ({
  ...getConfig(),
  allowLoopback: true,
  apiOrigins: new Set<string>(),
  dbHosts: new Set<string>(),
  dbPorts: new Set<number>(),
  targetBindings: [],
});
describe("URL and token API binding", () => {
  it("accepts URL plus token without manual identity or server binding config", async () => {
    const fixture = await server({
      databaseIdentity: null,
      fingerprint: databaseFingerprint(connection),
      version: 2,
    });
    await expect(
      verifyBinding(fixture.connection, config(), null)
    ).resolves.toMatchObject({ version: 2 });
    await bridgeRequest(fixture.connection, config(), "commands", {
      action: "cron.run-now",
    });
    expect(fixture.requests[1]?.headers["x-oms-database-fingerprint"]).toBe(
      databaseFingerprint(connection)
    );
    expect(fixture.requests[1]?.headers["x-oms-database-id"]).toBeUndefined();
    expect(fixture.requests[1]?.headers["x-oms-deployment-id"]).toBeUndefined();
    expect(fixture.requests[1]?.headers.authorization).toBe(`Bearer ${token}`);
  });
  it("rejects API pointed at another DB automatically", async () => {
    const fixture = await server({
      databaseIdentity: null,
      fingerprint: databaseFingerprint({
        ...connection,
        database: { ...connection.database, name: "production" },
      }),
      version: 2,
    });
    await expect(
      verifyBinding(fixture.connection, config(), null)
    ).rejects.toMatchObject({ code: "binding_mismatch" });
  });
  it("rejects a conflicting marker even at matching DB coordinates", async () => {
    const fixture = await server({
      databaseIdentity: "other-db",
      fingerprint: databaseFingerprint(connection),
      version: 2,
    });
    await expect(
      verifyBinding(fixture.connection, config(), marker)
    ).rejects.toMatchObject({ code: "binding_mismatch" });
  });
  it("discovers older bridge metadata from URL and token and preserves old request headers", async () => {
    const fixture = await server({
      databaseIdentity: marker,
      deploymentId: "old-stage",
      fingerprint: databaseFingerprint(connection),
      version: 1,
    });
    const identity = await verifyBinding(fixture.connection, config(), marker);
    expect(identity.databaseIdentity).toBe(marker);
    await bridgeRequest(fixture.connection, config(), "status", {});
    expect(fixture.requests[1]?.headers["x-oms-database-id"]).toBe(marker);
    expect(fixture.requests[1]?.headers["x-oms-deployment-id"]).toBe(
      "old-stage"
    );
  });
  it("rejects a saved connection whose known DB identity changed", async () => {
    const fixture = await server({
      databaseIdentity: "replacement",
      fingerprint: databaseFingerprint(connection),
      version: 2,
    });
    const saved = {
      ...fixture.connection,
      api: { ...fixture.connection.api, databaseIdentity: marker },
    };
    await expect(
      verifyBinding(saved, config(), "replacement")
    ).rejects.toMatchObject({ code: "binding_mismatch" });
    expect(fixture.requests).toHaveLength(0);
  });
  it("surfaces rejected tokens without returning credentials", async () => {
    const fixture = await server({ error: "unauthorized" }, 401);
    await expect(
      verifyBinding(fixture.connection, config(), null)
    ).rejects.toMatchObject({
      code: "bridge_rejected_definitive",
      status: 401,
    });
  });
  it("accepts API optional create data and token-only server presets", () => {
    const api = { origin: "https://oms.example.test", token };
    expect(connectionSchema.parse({ ...connection, api }).api).toEqual(api);
    expect(
      urlConnectionSchema.parse({
        api,
        environment: "staging",
        name: "Stage",
        url: "postgres://u:p@host/db",
      }).api
    ).toEqual(api);
    expect(
      readPreset("staging", {
        NODE_ENV: "test",
        OMS_STAGING_API_URL: api.origin,
        OMS_STAGING_DATABASE_URL: "postgres://u:p@host/db",
        OMS_STAGING_SERVICE_TOKEN: token,
      })?.api
    ).toMatchObject(api);
  });
});
