import { Pool } from "pg";
import { expect, it } from "vitest";
import type { Connection } from "../../server/profiles/schema";
import {
  workflowDetail,
  workflowRuns,
} from "../../server/services/workflow-logs";
import { omsPgTypes } from "../../server/target/clients";

const adminUrl = process.env.OMS_TEST_POSTGRES_URL;
if (!adminUrl) {
  throw new Error("OMS_TEST_POSTGRES_URL must point to disposable Postgres.");
}

it("filters and pages UTC workflow timestamps independently of host and SQL session timezone", async () => {
  const pool = new Pool({ connectionString: adminUrl, types: omsPgTypes });
  const db = await pool.connect();
  const connection: Connection = {
    accountIds: [],
    api: null,
    database: {
      host: "localhost",
      name: "fixture",
      password: "fixture",
      port: 5432,
      tls: false,
      user: "fixture",
    },
    globalDiagnostics: true,
  };
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL TIME ZONE 'Asia/Saigon'");
    await db.query(`CREATE TEMP TABLE workflow_run (
      id text,"accountId" text,"actorId" text,module text,"featureKey" text,"workflowKey" text,status text,title text,
      "createdAt" timestamp(3),"completedAt" timestamp(3),"startedAt" timestamp(3),"updatedAt" timestamp(3)
    ) ON COMMIT DROP`);
    await db.query(`CREATE TEMP TABLE workflow_run_log (
      id text,"workflowRunId" text,sequence int,level text,stage text,event text,status text,message text,
      "rowNumber" int,"shopDomain" text,"errorName" text,"errorCode" text,"errorMessage" text,"createdAt" timestamp(3)
    ) ON COMMIT DROP`);
    await db.query(`INSERT INTO workflow_run (id,module,"featureKey","workflowKey",status,title,"createdAt","startedAt","updatedAt") VALUES
      ('newer','ORDERS','orders.test','test.run','COMPLETED','Newer','2026-11-14 01:00:00','2026-11-14 01:00:00','2026-11-14 01:00:00'),
      ('older','ORDERS','orders.test','test.run','COMPLETED','Older','2026-11-14 00:00:00','2026-11-14 00:00:00','2026-11-14 00:00:00')`);
    const first = (await workflowRuns(db, connection, {
      from: "2026-11-14T00:00:00.000Z",
      limit: 1,
      to: "2026-11-14T02:00:00.000Z",
    })) as {
      rows: Record<string, unknown>[];
      next: { cursorDate: string; cursorId: string };
    };
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({
      id: "newer",
      startedAt: "2026-11-14T01:00:00.000Z",
      updatedAt: "2026-11-14T01:00:00.000Z",
    });
    expect(first.next).toEqual({
      cursorDate: "2026-11-14T01:00:00.000Z",
      cursorId: "newer",
    });
    expect(
      await workflowRuns(db, connection, { ...first.next, limit: 1 })
    ).toMatchObject({ next: null, rows: [{ id: "older" }] });
    expect(await workflowDetail(db, connection, "older", 0)).toMatchObject({
      run: {
        startedAt: "2026-11-14T00:00:00.000Z",
        updatedAt: "2026-11-14T00:00:00.000Z",
      },
    });
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
});
