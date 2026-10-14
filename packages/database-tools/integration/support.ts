import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import pg from "pg";

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";

const adminUrl = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL must point at the test Postgres server.");
  }
  return new URL(url);
};

const suffix = () => randomUUID().replaceAll("-", "").slice(0, 12);

/** A URL for another database on the test server, optionally as another role. */
export const urlFor = (
  databaseName: string,
  credentials?: { password: string; username: string }
): string => {
  const url = adminUrl();
  url.pathname = `/${databaseName}`;
  url.search = "";
  if (credentials) {
    url.username = encodeURIComponent(credentials.username);
    url.password = encodeURIComponent(credentials.password);
  }
  return url.toString();
};

export const withClient = async <T>(
  url: string,
  run: (client: pg.Client) => Promise<T>
): Promise<T> => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

/**
 * Creates roles and databases on the test server and removes them again.
 * Every role gets a distinctive password, so scanning for it is meaningful.
 */
export const createScratchServer = () => {
  const databases: string[] = [];
  const roles: string[] = [];

  return {
    async cleanup() {
      for (const name of databases.reverse()) {
        await prisma.$executeRawUnsafe(
          `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`
        );
      }
      for (const name of roles.reverse()) {
        await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${name}"`);
      }
    },
    async createDatabase(prefix: string, owner?: string) {
      const name = `${prefix}_${suffix()}`;
      await prisma.$executeRawUnsafe(
        `CREATE DATABASE "${name}"${owner ? ` OWNER "${owner}"` : ""}`
      );
      databases.push(name);
      return name;
    },
    async createRole(prefix: string) {
      const username = `${prefix}_${suffix()}`;
      const password = `Pw-${randomUUID()}`;
      await prisma.$executeRawUnsafe(
        `CREATE ROLE "${username}" LOGIN PASSWORD '${password}'`
      );
      roles.push(username);
      return { password, username };
    },
  };
};

export const createOrganization = async () => {
  const id = suffix();
  const user = await prisma.user.create({
    data: {
      email: `database-tools-${id}@example.com`,
      emailVerified: true,
      name: "Database tools test",
      status: "ACTIVE",
    },
  });
  const organization = await prisma.organization.create({
    data: { name: `Database tools ${id}`, slug: `database-tools-${id}` },
  });
  return {
    actorId: user.id,
    async cleanup() {
      await prisma.organization.delete({ where: { id: organization.id } });
      await prisma.user.delete({ where: { id: user.id } });
    },
    organizationId: organization.id,
  };
};

/** Every audit row of an organization, as text, for scanning. */
export const auditText = async (organizationId: string) =>
  JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId } }));
