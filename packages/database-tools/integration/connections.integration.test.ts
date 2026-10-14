import { prisma } from "@repo/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkConnection,
  createConnection,
  DatabaseToolsError,
  deleteConnection,
  listConnections,
  updateConnection,
} from "../src";
import {
  auditText,
  createOrganization,
  createScratchServer,
  urlFor,
} from "./support";

const SERVER_VERSION = /^\d+/;

const scratch = createScratchServer();
let organization: Awaited<ReturnType<typeof createOrganization>>;
let role: { password: string; username: string };
let databaseName: string;

const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DatabaseToolsError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected a DatabaseToolsError.");
};

beforeAll(async () => {
  organization = await createOrganization();
  role = await scratch.createRole("conn_role");
  databaseName = await scratch.createDatabase("conn_db", role.username);
});

afterAll(async () => {
  await organization?.cleanup();
  await scratch.cleanup();
});

describe("database connections", () => {
  it("saves a reachable URL, ignoring ORM parameters, with the URL encrypted", async () => {
    const url = `${urlFor(databaseName, role)}?schema=public&connection_limit=5`;

    const connection = await createConnection({
      actorId: organization.actorId,
      name: "  Production  ",
      organizationId: organization.organizationId,
      url,
    });

    expect(connection).toMatchObject({
      databaseName,
      engine: "POSTGRESQL",
      lastCheckError: null,
      name: "Production",
      username: role.username,
    });
    expect(connection.serverVersion).toMatch(SERVER_VERSION);
    expect(connection.urlEncrypted).not.toContain(role.password);
    expect(connection.urlEncrypted).not.toContain(databaseName);
    expect(await auditText(organization.organizationId)).not.toContain(
      role.password
    );
    await expect(
      listConnections(organization.organizationId)
    ).resolves.toHaveLength(1);
  });

  it("refuses a duplicate name", async () => {
    const error = await failureOf(
      createConnection({
        actorId: organization.actorId,
        name: "Production",
        organizationId: organization.organizationId,
        url: urlFor(databaseName, role),
      })
    );
    expect(error.failure).toBe("NAME_TAKEN");
  });

  it("refuses a wrong password without revealing it", async () => {
    const wrong = { ...role, password: "Wrong-Password-Value-123" };
    const error = await failureOf(
      createConnection({
        actorId: organization.actorId,
        name: "Wrong",
        organizationId: organization.organizationId,
        url: urlFor(databaseName, wrong),
      })
    );
    expect(error.failure).toBe("CONNECTION_FAILED");
    expect(error.message).not.toContain(wrong.password);
    expect(error.message).toContain(databaseName);
  });

  it("refuses an engine that is not supported yet", async () => {
    const error = await failureOf(
      createConnection({
        actorId: organization.actorId,
        name: "MySQL",
        organizationId: organization.organizationId,
        url: "mysql://root:secret@localhost:3306/app",
      })
    );
    expect(error.failure).toBe("UNSUPPORTED_ENGINE");
  });

  it("records a failed check on the connection instead of throwing", async () => {
    const [connection] = await listConnections(organization.organizationId);
    if (!connection) {
      throw new Error("expected a connection");
    }
    const scope = {
      connectionId: connection.id,
      organizationId: organization.organizationId,
    };

    await expect(checkConnection(scope)).resolves.toMatchObject({
      lastCheckError: null,
    });

    await prisma.$executeRawUnsafe(
      `ALTER ROLE "${role.username}" PASSWORD 'rotated-elsewhere-123'`
    );
    try {
      const failed = await checkConnection(scope);
      expect(failed.lastCheckError).toContain("password authentication failed");
      expect(failed.lastCheckError).not.toContain(role.password);
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER ROLE "${role.username}" PASSWORD '${role.password}'`
      );
    }
  });

  it("renames, and refuses to delete while a backup is running", async () => {
    const [connection] = await listConnections(organization.organizationId);
    if (!connection) {
      throw new Error("expected a connection");
    }
    const scope = {
      connectionId: connection.id,
      organizationId: organization.organizationId,
    };

    const renamed = await updateConnection({
      actorId: organization.actorId,
      name: "EVISU production",
      scope,
    });
    expect(renamed.name).toBe("EVISU production");
    expect(renamed.urlEncrypted).toBe(connection.urlEncrypted);

    const running = await prisma.databaseBackup.create({
      data: {
        connectionId: connection.id,
        connectionName: renamed.name,
        databaseName,
        engine: "POSTGRESQL",
        organizationId: organization.organizationId,
        status: "RUNNING",
      },
    });
    const busy = await failureOf(
      deleteConnection({ actorId: organization.actorId, scope })
    );
    expect(busy.failure).toBe("CONNECTION_BUSY");

    await prisma.databaseBackup.update({
      data: { status: "COMPLETED" },
      where: { id: running.id },
    });
    await deleteConnection({ actorId: organization.actorId, scope });

    await expect(
      listConnections(organization.organizationId)
    ).resolves.toHaveLength(0);
    await expect(
      prisma.databaseBackup.findUnique({ where: { id: running.id } })
    ).resolves.toMatchObject({
      connectionId: null,
      connectionName: "EVISU production",
    });
  });

  it("does not find another organization's connection", async () => {
    const other = await createOrganization();
    try {
      const connection = await createConnection({
        actorId: other.actorId,
        name: "Theirs",
        organizationId: other.organizationId,
        url: urlFor(databaseName, role),
      });
      const error = await failureOf(
        checkConnection({
          connectionId: connection.id,
          organizationId: organization.organizationId,
        })
      );
      expect(error.failure).toBe("CONNECTION_NOT_FOUND");
    } finally {
      await other.cleanup();
    }
  });
});
