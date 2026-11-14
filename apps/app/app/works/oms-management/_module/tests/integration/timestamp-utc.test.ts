import { Pool } from "pg";
import { expect, it } from "vitest";
import { omsPgTypes } from "../../server/target/clients";

const adminUrl = process.env.OMS_TEST_POSTGRES_URL;
if (!adminUrl) {
  throw new Error("OMS_TEST_POSTGRES_URL must point to disposable Postgres.");
}

it("preserves UTC versions and CAS on a non-UTC host and DB session", async () => {
  expect(process.env.TZ).toBe("Asia/Saigon");
  const pool = new Pool({ connectionString: adminUrl, types: omsPgTypes });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL TIME ZONE 'Asia/Saigon'");
    await db.query(
      'CREATE TEMP TABLE oms_timestamp_test (id int, "updatedAt" timestamp(3)) ON COMMIT DROP'
    );
    await db.query(
      "INSERT INTO oms_timestamp_test VALUES (1, '2026-11-10 03:17:39.983')"
    );
    const version = (
      await db.query('SELECT "updatedAt" FROM oms_timestamp_test')
    ).rows[0].updatedAt.toISOString();
    expect(version).toBe("2026-11-10T03:17:39.983Z");
    const query =
      'UPDATE oms_timestamp_test SET "updatedAt"="updatedAt"+interval \'1 millisecond\' WHERE id=1 AND "updatedAt"=($1::timestamptz AT TIME ZONE \'UTC\')';
    expect((await db.query(query, [version])).rowCount).toBe(1);
    expect((await db.query(query, [version])).rowCount).toBe(0);
    const current = (
      await db.query('SELECT "updatedAt" FROM oms_timestamp_test')
    ).rows[0].updatedAt.toISOString();
    expect(
      (
        await db.query(
          "DELETE FROM oms_timestamp_test WHERE \"updatedAt\"=($1::timestamptz AT TIME ZONE 'UTC')",
          [current]
        )
      ).rowCount
    ).toBe(1);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
});
