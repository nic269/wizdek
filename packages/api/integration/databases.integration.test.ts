import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@repo/database";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getJobProvider, registerJobs } from "../src/jobs";
import { type Actor, createApiHarness } from "./support";

vi.mock("@repo/auth/session", () => ({ getCurrentSession: vi.fn() }));

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";
process.env.JOBS_PROVIDER = "local";
process.env.STORAGE_PROVIDER = "local";
process.env.LOCAL_STORAGE_DIR = await mkdtemp(
  join(tmpdir(), "api-database-backups-")
);

const {
  call,
  cleanup,
  createActor,
  createOrganization,
  request,
  responseBodies,
} = createApiHarness();

const suffix = () => randomUUID().replaceAll("-", "").slice(0, 12);
const roleName = `api_backup_${suffix()}`;
const rolePassword = `Pw-${randomUUID()}`;
const databaseName = `api_backup_db_${suffix()}`;

const databaseUrl = () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = `/${databaseName}`;
  url.search = "";
  url.username = roleName;
  url.password = rolePassword;
  return url.toString();
};

let owner: Actor;
let member: Actor;
let viewer: Actor;
let outsider: Actor;

const createConnection = (actor: Actor, name = "Production") =>
  call(
    actor,
    "POST",
    `/api/organizations/${actor.organizationId}/databases/connections`,
    { name, url: `${databaseUrl()}?schema=public` }
  );

const waitForBackup = async (actor: Actor, backupId: string) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await call(
      actor,
      "GET",
      `/api/databases/backups/${backupId}`
    );
    const { status } = response.json.data;
    if (status === "COMPLETED" || status === "FAILED") {
      return response.json.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The backup did not finish in time.");
};

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}'`
  );
  await prisma.$executeRawUnsafe(
    `CREATE DATABASE "${databaseName}" OWNER "${roleName}"`
  );
  const jobs = getJobProvider();
  registerJobs(jobs);
  await jobs.start();

  const organization = await createOrganization();
  owner = await createActor("Owner", organization);
  member = await createActor("Member", organization);
  viewer = await createActor("Viewer", organization);
  outsider = await createActor("Owner");
});

afterEach(async () => {
  await getJobProvider().waitUntilIdle();
});

afterAll(async () => {
  await getJobProvider().stop();
  await cleanup();
  await prisma.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`
  );
  await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${roleName}"`);
});

describe("database tools API", () => {
  let connectionId: string;
  let backupId: string;

  it("lets an owner save, list, check and rename a connection", async () => {
    const created = await createConnection(owner);
    expect(created.status).toBe(201);
    expect(created.json.data).toMatchObject({
      databaseName,
      engine: "POSTGRESQL",
      name: "Production",
      username: roleName,
    });
    expect(created.json.data).not.toHaveProperty("urlEncrypted");
    connectionId = created.json.data.id;

    const listed = await call(
      owner,
      "GET",
      `/api/organizations/${owner.organizationId}/databases/connections`
    );
    expect(listed.json.data).toHaveLength(1);

    const checked = await call(
      owner,
      "POST",
      `/api/databases/connections/${connectionId}/check`
    );
    expect(checked.json.data.lastCheckError).toBeNull();

    const renamed = await call(
      owner,
      "PATCH",
      `/api/databases/connections/${connectionId}`,
      { name: "EVISU production" }
    );
    expect(renamed.json.data.name).toBe("EVISU production");
  });

  it("explains a connection that cannot be reached or is not supported", async () => {
    const unreachable = await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/databases/connections`,
      {
        name: "Wrong password",
        url: databaseUrl().replace(rolePassword, "not-the-password-987"),
      }
    );
    expect(unreachable.status).toBe(422);
    expect(unreachable.json.error.details.reason).toBe("CONNECTION_FAILED");
    expect(JSON.stringify(unreachable.json)).not.toContain(
      "not-the-password-987"
    );

    const mysql = await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/databases/connections`,
      { name: "MySQL", url: "mysql://root:secret@localhost/app" }
    );
    expect(mysql.status).toBe(422);
    expect(mysql.json.error.details.reason).toBe("UNSUPPORTED_ENGINE");
  });

  it("backs up in the background and serves the archive to an owner", async () => {
    const started = await call(
      owner,
      "POST",
      `/api/databases/connections/${connectionId}/backups`
    );
    expect(started.status).toBe(202);
    expect(started.json.data.status).toBe("QUEUED");
    backupId = started.json.data.id;

    const finished = await waitForBackup(owner, backupId);
    expect(finished).toMatchObject({
      connectionName: "EVISU production",
      error: null,
      status: "COMPLETED",
    });
    expect(Number(finished.sizeBytes)).toBeGreaterThan(0);

    const download = await request(
      owner,
      `/api/databases/backups/${backupId}/download`
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(
      finished.fileName
    );
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(String(bytes.byteLength)).toBe(finished.sizeBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      finished.checksumSha256
    );
    // A custom-format archive starts with this signature.
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("PGDMP");

    const history = await call(
      owner,
      "GET",
      `/api/databases/connections/${connectionId}/backups`
    );
    expect(
      history.json.data.map((backup: { id: string }) => backup.id)
    ).toEqual([backupId]);
  });

  it("gives members and viewers no access, and hides records from outsiders", async () => {
    for (const actor of [member, viewer]) {
      const responses = [
        await call(
          actor,
          "GET",
          `/api/organizations/${owner.organizationId}/databases/connections`
        ),
        await call(actor, "GET", `/api/databases/connections/${connectionId}`),
        await call(
          actor,
          "POST",
          `/api/databases/connections/${connectionId}/backups`
        ),
        await call(actor, "GET", `/api/databases/backups/${backupId}`),
        await createConnection(actor, "Not allowed"),
      ];
      expect(responses.map((response) => response.status)).toEqual([
        403, 403, 403, 403, 403,
      ]);
      const download = await request(
        actor,
        `/api/databases/backups/${backupId}/download`
      );
      expect(download.status).toBe(403);
    }

    expect(
      (
        await call(
          outsider,
          "GET",
          `/api/databases/connections/${connectionId}`
        )
      ).status
    ).toBe(404);
    expect(
      (await request(outsider, `/api/databases/backups/${backupId}/download`))
        .status
    ).toBe(404);
    expect(
      (await request(null, `/api/databases/backups/${backupId}/download`))
        .status
    ).toBe(401);
  });

  it("refuses to delete a connection while its backup runs", async () => {
    const running = await prisma.databaseBackup.create({
      data: {
        connectionId,
        connectionName: "EVISU production",
        databaseName,
        engine: "POSTGRESQL",
        organizationId: owner.organizationId,
        status: "RUNNING",
      },
    });
    const busy = await call(
      owner,
      "DELETE",
      `/api/databases/connections/${connectionId}`
    );
    expect(busy.status).toBe(409);
    await prisma.databaseBackup.delete({ where: { id: running.id } });
  });

  it("deletes the connection but keeps its backups until they are deleted", async () => {
    const deleted = await call(
      owner,
      "DELETE",
      `/api/databases/connections/${connectionId}`
    );
    expect(deleted.status).toBe(200);

    const remaining = await call(
      owner,
      "GET",
      `/api/organizations/${owner.organizationId}/databases/backups`
    );
    expect(remaining.json.data).toEqual([
      expect.objectContaining({ connectionId: null, id: backupId }),
    ]);
    expect(
      (await request(owner, `/api/databases/backups/${backupId}/download`))
        .status
    ).toBe(200);

    const removed = await call(
      owner,
      "DELETE",
      `/api/databases/backups/${backupId}`
    );
    expect(removed.status).toBe(200);
    expect(
      (await request(owner, `/api/databases/backups/${backupId}/download`))
        .status
    ).toBe(404);
  });

  it("never returns or records the password, and audits each step", async () => {
    for (const body of responseBodies) {
      expect(body).not.toContain(rolePassword);
      expect(body).not.toContain(encodeURIComponent(rolePassword));
    }
    const audit = await prisma.auditLog.findMany({
      where: { organizationId: owner.organizationId },
    });
    expect(JSON.stringify(audit)).not.toContain(rolePassword);
    expect(audit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "database.connection.created",
        "database.connection.updated",
        "database.backup.started",
        "database.backup.downloaded",
        "database.connection.deleted",
        "database.backup.deleted",
      ])
    );
  });
});
