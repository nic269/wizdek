import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { prisma } from "@repo/database";
import { createLocalJobProvider, type JobQueueProvider } from "@repo/jobs";
import { createLocalStorageProvider } from "@repo/storage";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  adapterForEngine,
  createConnection,
  createDatabaseBackupJob,
  type DatabaseBackupRecord,
  type DatabaseEngineAdapter,
  failStaleBackups,
  runBackup,
  startBackup,
} from "../src";
import { libpqEnvironment } from "../src/engines/postgres/env";
import { runTool } from "../src/engines/run-tool";
import { postgresToolPath } from "../src/keys";
import {
  auditText,
  createOrganization,
  createScratchServer,
  urlFor,
  withClient,
} from "./support";

const SEED_SQL = `
  CREATE TABLE customers (id serial PRIMARY KEY, name text NOT NULL);
  CREATE TABLE orders (
    id bigserial PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES customers (id),
    total numeric(10, 2) NOT NULL,
    placed_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX orders_customer_idx ON orders (customer_id);
  CREATE SEQUENCE invoice_number_seq START 1000;
  CREATE VIEW customer_totals AS
    SELECT customer_id, sum(total) AS total FROM orders GROUP BY customer_id;
  CREATE SCHEMA audit;
  CREATE TABLE audit.events (id serial PRIMARY KEY, payload jsonb NOT NULL);

  INSERT INTO customers (name) SELECT 'customer ' || n FROM generate_series(1, 50) n;
  INSERT INTO orders (customer_id, total)
    SELECT 1 + (n % 50), (n * 1.25)::numeric(10, 2) FROM generate_series(1, 500) n;
  INSERT INTO audit.events (payload)
    SELECT jsonb_build_object('n', n) FROM generate_series(1, 25) n;
  SELECT setval('invoice_number_seq', 1234);
`;

const BACKUP_FILE_NAME = /^Source-.+\.dump$/;
const PG_DUMP_VERSION = /^pg_dump \(PostgreSQL\) \d+/;
const CLIENT_UPGRADE_HINT = /client \d+ or newer/;

const TABLES_SQL = `
  SELECT table_schema || '.' || table_name AS name, table_type AS type
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY 1`;

/** Every table and view, with a row count for each table. */
const describeDatabase = (url: string) =>
  withClient(url, async (client) => {
    const { rows } = await client.query<{ name: string; type: string }>(
      TABLES_SQL
    );
    const shape: Record<string, number | "view"> = {};
    for (const { name, type } of rows) {
      if (type === "VIEW") {
        shape[name] = "view";
        continue;
      }
      const [schema, table] = name.split(".");
      const count = await client.query<{ count: string }>(
        `SELECT count(*) FROM "${schema}"."${table}"`
      );
      shape[name] = Number(count.rows[0]?.count);
    }
    const sequence = await client.query<{ last_value: string }>(
      "SELECT last_value FROM invoice_number_seq"
    );
    return { sequence: sequence.rows[0]?.last_value, shape };
  });

const scratch = createScratchServer();
const providers: JobQueueProvider[] = [];
let organization: Awaited<ReturnType<typeof createOrganization>>;
let role: { password: string; username: string };
let sourceDatabase: string;
let sourceUrl: string;
let storageRoot: string;
let tempRoot: string;
let connectionId: string;
let logLines: string[] = [];

const storage = () => createLocalStorageProvider(storageRoot);
const deps = (adapterFor?: () => DatabaseEngineAdapter) => ({
  ...(adapterFor ? { adapterFor } : {}),
  storage,
  tempDirectory: () => tempRoot,
});

const waitForFinish = async (backupId: string) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const backup = await prisma.databaseBackup.findUniqueOrThrow({
      where: { id: backupId },
    });
    if (backup.status === "COMPLETED" || backup.status === "FAILED") {
      return backup;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The backup did not finish in time.");
};

const queueBackup = async () =>
  prisma.databaseBackup.create({
    data: {
      connectionId,
      connectionName: "Source",
      databaseName: sourceDatabase,
      engine: "POSTGRESQL",
      organizationId: organization.organizationId,
    },
  });

const storedFiles = async () =>
  (await readdir(storageRoot, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

const expectNoSecrets = (text: string) => {
  expect(text).not.toContain(role.password);
  expect(text).not.toContain(encodeURIComponent(role.password));
  expect(text).not.toContain(sourceUrl);
};

beforeAll(async () => {
  // Fails here, with install guidance, when the client tools are missing.
  await adapterForEngine("POSTGRESQL").toolVersion();

  organization = await createOrganization();
  role = await scratch.createRole("backup_role");
  sourceDatabase = await scratch.createDatabase("backup_src", role.username);
  sourceUrl = urlFor(sourceDatabase, role);
  await withClient(sourceUrl, (client) => client.query(SEED_SQL));
  storageRoot = await mkdtemp(join(tmpdir(), "backup-storage-"));
  tempRoot = await mkdtemp(join(tmpdir(), "backup-temp-"));

  const connection = await createConnection({
    actorId: organization.actorId,
    name: "Source",
    organizationId: organization.organizationId,
    url: sourceUrl,
  });
  connectionId = connection.id;

  for (const method of ["log", "warn", "error"] as const) {
    const original = console[method];
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logLines.push(args.map((arg) => JSON.stringify(arg)).join(" "));
      original(...args);
    });
  }
});

afterEach(async () => {
  // A temporary dump never outlives its backup, whatever the outcome.
  await expect(readdir(tempRoot)).resolves.toEqual([]);
});

afterAll(async () => {
  for (const provider of providers) {
    await provider.stop();
  }
  vi.restoreAllMocks();
  await organization?.cleanup();
  await scratch.cleanup();
});

describe("database backups", () => {
  let completed: DatabaseBackupRecord;

  it("backs up through the job, and the archive restores to the same data", async () => {
    logLines = [];
    const jobs = createLocalJobProvider();
    providers.push(jobs);
    jobs.register(createDatabaseBackupJob(deps()));
    await jobs.start();

    const queued = await startBackup(
      {
        actorId: organization.actorId,
        scope: { connectionId, organizationId: organization.organizationId },
      },
      jobs
    );
    completed = await waitForFinish(queued.id);

    expect(completed).toMatchObject({
      error: null,
      status: "COMPLETED",
      storageProvider: "local",
    });
    expect(completed.fileName).toMatch(BACKUP_FILE_NAME);
    expect(completed.toolVersion).toMatch(PG_DUMP_VERSION);

    // The stored object is the archive the row describes.
    const archive = join(tempRoot, "..", `restore-${completed.id}.dump`);
    const object = await storage().getObjectStream({
      key: completed.objectKey ?? "",
    });
    await pipeline(object.body, createWriteStream(archive));
    const bytes = await readFile(archive);
    expect(BigInt(bytes.byteLength)).toBe(completed.sizeBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      completed.checksumSha256
    );

    const restoredDatabase = await scratch.createDatabase(
      "backup_dst",
      role.username
    );
    const restoredUrl = urlFor(restoredDatabase, role);
    await runTool({
      args: ["--no-owner", `--dbname=${restoredDatabase}`, archive],
      command: postgresToolPath("pg_restore"),
      env: libpqEnvironment({
        databaseName: restoredDatabase,
        host: new URL(restoredUrl).hostname,
        password: role.password,
        port: Number(new URL(restoredUrl).port || 5432),
        username: role.username,
      }),
    });

    const source = await describeDatabase(sourceUrl);
    expect(source.shape).toMatchObject({
      "audit.events": 25,
      "public.customer_totals": "view",
      "public.customers": 50,
      "public.orders": 500,
    });
    await expect(describeDatabase(restoredUrl)).resolves.toEqual(source);

    // No credential reaches the row, the audit log, the job record or logs.
    expectNoSecrets(
      JSON.stringify(completed, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );
    expectNoSecrets(await auditText(organization.organizationId));
    expectNoSecrets(JSON.stringify(await jobs.listRuns()));
    expectNoSecrets(logLines.join("\n"));
  });

  it("does nothing when a finished backup is delivered again", async () => {
    let dumped = false;
    const postgres = adapterForEngine("POSTGRESQL");
    await runBackup(
      completed.id,
      new AbortController().signal,
      deps(() => ({
        ...postgres,
        dump: (input) => {
          dumped = true;
          return postgres.dump(input);
        },
      }))
    );
    expect(dumped).toBe(false);
    await expect(
      prisma.databaseBackup.findUniqueOrThrow({ where: { id: completed.id } })
    ).resolves.toEqual(completed);
  });

  it("fails without dumping when pg_dump is older than the server", async () => {
    let dumped = false;
    const postgres = adapterForEngine("POSTGRESQL");
    const backup = await queueBackup();
    const filesBefore = await storedFiles();

    await runBackup(
      backup.id,
      new AbortController().signal,
      deps(() => ({
        ...postgres,
        dump: (input) => {
          dumped = true;
          return postgres.dump(input);
        },
        toolVersion: () =>
          Promise.resolve({ major: 9, text: "pg_dump (PostgreSQL) 9.6.24" }),
      }))
    );

    const failed = await prisma.databaseBackup.findUniqueOrThrow({
      where: { id: backup.id },
    });
    expect(dumped).toBe(false);
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain(
      "pg_dump (PostgreSQL) 9.6.24 cannot back up"
    );
    expect(failed.error).toMatch(CLIENT_UPGRADE_HINT);
    await expect(storedFiles()).resolves.toEqual(filesBefore);
  });

  it("fails cleanly, without the password, when the credentials stop working", async () => {
    logLines = [];
    const backup = await queueBackup();
    const filesBefore = await storedFiles();
    await prisma.$executeRawUnsafe(
      `ALTER ROLE "${role.username}" PASSWORD 'rotated-elsewhere-456'`
    );
    try {
      await runBackup(backup.id, new AbortController().signal, deps());
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER ROLE "${role.username}" PASSWORD '${role.password}'`
      );
    }

    const failed = await prisma.databaseBackup.findUniqueOrThrow({
      where: { id: backup.id },
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain("password authentication failed");
    expectNoSecrets(failed.error ?? "");
    expectNoSecrets(logLines.join("\n"));
    await expect(storedFiles()).resolves.toEqual(filesBefore);
  });

  it("stops and stores nothing when the backup is aborted", async () => {
    const controller = new AbortController();
    const postgres = adapterForEngine("POSTGRESQL");
    const backup = await queueBackup();
    const filesBefore = await storedFiles();

    await runBackup(
      backup.id,
      controller.signal,
      deps(() => ({
        ...postgres,
        dump: (input) => {
          controller.abort();
          return postgres.dump(input);
        },
      }))
    );

    const failed = await prisma.databaseBackup.findUniqueOrThrow({
      where: { id: backup.id },
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain("stopped");
    await expect(storedFiles()).resolves.toEqual(filesBefore);
  });

  it("records a failure when storage cannot be opened", async () => {
    const backup = await queueBackup();

    await runBackup(backup.id, new AbortController().signal, {
      storage: () => {
        throw new Error("s3 storage configuration is missing: S3_BUCKET.");
      },
      tempDirectory: () => tempRoot,
    });

    await expect(
      prisma.databaseBackup.findUniqueOrThrow({ where: { id: backup.id } })
    ).resolves.toMatchObject({
      error: "s3 storage configuration is missing: S3_BUCKET.",
      status: "FAILED",
    });
  });

  it("marks backups lost with their process as failed", async () => {
    const stale = await queueBackup();
    await prisma.databaseBackup.update({
      data: { status: "RUNNING" },
      where: { id: stale.id },
    });

    await expect(failStaleBackups(new Date(Date.now() - 60_000))).resolves.toBe(
      0
    );
    await expect(
      failStaleBackups(new Date(Date.now() + 1000))
    ).resolves.toBeGreaterThanOrEqual(1);
    await expect(
      prisma.databaseBackup.findUniqueOrThrow({ where: { id: stale.id } })
    ).resolves.toMatchObject({ status: "FAILED" });
  });
});
