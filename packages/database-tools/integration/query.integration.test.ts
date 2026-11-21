import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresAdapter } from "../src/engines/postgres";
import { DatabaseToolsError } from "../src/errors";

const table = `query_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const limits = { maxBytes: 10_000_000, maxRows: 10_000, timeoutMs: 10_000 };
const target = () => postgresAdapter.parseUrl(process.env.DATABASE_URL ?? "");

const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the query to fail.");
};

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `create table ${table} (id serial primary key, note text not null)`
  );
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`drop table if exists ${table}`);
  await prisma.$disconnect();
});

describe("postgres queries", () => {
  it("sends values apart from the text and reports rows and fields", async () => {
    const [result] = await postgresAdapter.query(
      target(),
      [{ params: ["it's"], sql: "select $1::text as note, 2 as two" }],
      limits
    );
    expect(result).toMatchObject({
      command: "SELECT",
      rowCount: 1,
      rows: [{ note: "it's", two: 2 }],
      truncated: false,
    });
    expect(result?.fields.map((field) => field.name)).toEqual(["note", "two"]);
  });

  it("refuses several statements in one text, even without values", async () => {
    const error = await failureOf(
      postgresAdapter.query(
        target(),
        [{ params: [], sql: `select 1; delete from ${table}` }],
        limits
      )
    );
    expect(error).toBeInstanceOf(DatabaseToolsError);
    expect((error as DatabaseToolsError).failure).toBe("QUERY_FAILED");
  });

  it("rolls a transaction back when one statement fails", async () => {
    const error = await failureOf(
      postgresAdapter.query(
        target(),
        [
          { params: ["gone"], sql: `insert into ${table} (note) values ($1)` },
          { params: [], sql: "select * from no_such_table_here" },
        ],
        limits
      )
    );
    expect((error as Error).message).toContain("no_such_table_here");
    await expect(
      prisma.$queryRawUnsafe(`select count(*)::int as n from ${table}`)
    ).resolves.toEqual([{ n: 0 }]);
  });

  it("keeps at most the row budget and says the result was cut", async () => {
    const [result] = await postgresAdapter.query(
      target(),
      [{ params: [], sql: "select n from generate_series(1, 30) as n" }],
      { ...limits, maxRows: 10 }
    );
    expect(result?.rows).toHaveLength(10);
    expect(result?.truncated).toBe(true);
  });

  it("stops a statement at the timeout", async () => {
    const started = Date.now();
    const error = await failureOf(
      postgresAdapter.query(
        target(),
        [{ params: [], sql: "select pg_sleep(5)" }],
        { ...limits, timeoutMs: 300 }
      )
    );
    expect((error as Error).message).toContain("statement timeout");
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
