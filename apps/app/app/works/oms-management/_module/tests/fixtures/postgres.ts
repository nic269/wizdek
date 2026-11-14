import { Pool } from "pg";
import type { Connection } from "../../server/profiles/schema";

const DATABASES = ["oms_isolation_a", "oms_isolation_b"] as const;

const databaseUrl = (
  adminUrl: string,
  database: string,
  user: string,
  password: string
) => {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  url.username = user;
  url.password = password;
  return url.toString();
};

export interface PostgresFixture {
  adminUrl: string;
  connections: Record<(typeof DATABASES)[number], Connection>;
  diagnosticUrls: Record<(typeof DATABASES)[number], string>;
  overprivilegedUrl: string;
  port: number;
}

export async function preparePostgresFixture(
  adminUrl: string
): Promise<PostgresFixture> {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    await admin.query(`
      CREATE ROLE oms_diagnostic LOGIN PASSWORD 'diagnostic_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE oms_overprivileged LOGIN PASSWORD 'overprivileged_password' NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    `);
    for (const database of DATABASES) {
      await admin.query(`CREATE DATABASE ${database}`);
    }
  } finally {
    await admin.end();
  }

  for (const [index, database] of DATABASES.entries()) {
    const owner = new Pool({
      connectionString: databaseUrl(
        adminUrl,
        database,
        "postgres",
        "oms_test_password"
      ),
      max: 1,
    });
    try {
      await owner.query(`
        REVOKE ALL ON DATABASE ${database} FROM PUBLIC;
        GRANT CONNECT ON DATABASE ${database} TO oms_diagnostic, oms_overprivileged;
        REVOKE ALL ON SCHEMA public FROM PUBLIC;
        GRANT USAGE ON SCHEMA public TO oms_diagnostic, oms_overprivileged;

        CREATE TABLE workflow_run (
          id text PRIMARY KEY,
          "accountId" text NOT NULL,
          "actorId" text,
          module text NOT NULL,
          "featureKey" text NOT NULL,
          "workflowKey" text,
          "targetType" text,
          "targetId" text,
          "startedAt" timestamptz,
          "durationMs" integer,
          status text NOT NULL,
          title text NOT NULL,
          summary text,
          "createdAt" timestamptz NOT NULL,
          "completedAt" timestamptz
        );
        CREATE TABLE workflow_run_log (
          id text PRIMARY KEY,
          "workflowRunId" text NOT NULL,
          sequence integer NOT NULL,
          level text,
          stage text,
          event text,
          status text,
          message text,
          "rowNumber" integer,
          "shopDomain" text,
          "errorName" text,
          "errorCode" text,
          "errorMessage" text,
          "targetType" text,
          "targetId" text,
          "operationName" text,
          "durationMs" integer,
          metadata jsonb,
          "errorDetails" jsonb,
          "createdAt" timestamptz NOT NULL
        );
        CREATE TABLE scheduled_job_config (
          "jobKey" text PRIMARY KEY,
          enabled boolean NOT NULL,
          "cronExpression" text NOT NULL,
          "lastCheckedAt" timestamptz,
          "lastActivityAt" timestamptz,
          "lastSuccessAt" timestamptz,
          "lastFailureAt" timestamptz,
          "consecutiveFailures" integer NOT NULL DEFAULT 0,
          "updatedAt" timestamptz NOT NULL
        );
        CREATE TABLE scheduled_job_run (
          id text PRIMARY KEY,
          "jobKey" text NOT NULL,
          status text NOT NULL,
          trigger text,
          "startedAt" timestamptz NOT NULL,
          "completedAt" timestamptz,
          "errorMessage" text,
          "workflowRunId" text,
          "createdAt" timestamptz NOT NULL
        );
        CREATE TABLE site_setting (
          key text PRIMARY KEY,
          value text NOT NULL,
          "createdAt" timestamptz NOT NULL,
          "updatedAt" timestamptz NOT NULL
        );
        CREATE TABLE audit_log (
          id text PRIMARY KEY,
          "actorId" text,
          action text NOT NULL,
          "targetType" text NOT NULL,
          "targetId" text NOT NULL,
          metadata jsonb NOT NULL,
          "createdAt" timestamptz NOT NULL
        );
        CREATE INDEX workflow_run_account_cursor
          ON workflow_run ("accountId", "createdAt" DESC, id DESC);
        CREATE INDEX workflow_run_log_run_sequence
          ON workflow_run_log ("workflowRunId", sequence);

        INSERT INTO workflow_run (
          id, "accountId", "actorId", module, "featureKey", "workflowKey",
          status, title, summary, "createdAt", "completedAt"
        ) VALUES (
          'shared-id', 'account-1', 'actor-1', 'fixture', 'isolation', 'fixture.run',
          'FAILED', 'database-${index + 1}', 'fixture summary',
          '2030-01-02T00:00:00.000Z', '2030-01-02T00:01:00.000Z'
        );
        INSERT INTO workflow_run_log (
          id, "workflowRunId", sequence, level, stage, event, status, message,
          "rowNumber", "shopDomain", "errorName", "errorCode", "errorMessage", "createdAt"
        ) VALUES (
          'shared-log', 'shared-id', 1, 'error', 'fixture', 'failed', 'FAILED',
          'log-database-${index + 1}', 1, 'shop.example', 'FixtureError', 'FIXTURE',
          'failure-database-${index + 1}', '2030-01-02T00:00:30.000Z'
        );
        INSERT INTO site_setting (key,value,"createdAt","updatedAt") VALUES (
          'management.databaseIdentity',
          '2c878880-ec61-43d9-a857-1ee32038a3fd',
          '2030-01-01T00:00:00.000Z',
          '2030-01-01T00:00:00.000Z'
        );
        ${
          index === 0
            ? `INSERT INTO workflow_run (
                id, "accountId", "actorId", module, "featureKey", "workflowKey",
                status, title, summary, "createdAt", "completedAt"
              )
              SELECT
                'bulk-' || lpad(value::text, 6, '0'), 'account-1', 'actor-1',
                'bulk', 'pagination', 'bulk.run', 'FAILED', 'Bulk row ' || value,
                NULL, '2030-01-01T00:00:00.000Z'::timestamptz - value * interval '1 second', NULL
              FROM generate_series(1, 100000) AS value;`
            : ""
        }
        GRANT SELECT ON workflow_run, workflow_run_log, scheduled_job_config, scheduled_job_run
          TO oms_diagnostic, oms_overprivileged;
        GRANT SELECT, INSERT, UPDATE, DELETE ON site_setting TO oms_diagnostic, oms_overprivileged;
        GRANT SELECT, INSERT ON audit_log TO oms_diagnostic, oms_overprivileged;
        CREATE TABLE workspace_account (id text PRIMARY KEY, name text NOT NULL);
        CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL);
        CREATE TABLE workspace_account_user ("accountId" text, "userId" text);
        INSERT INTO workspace_account VALUES ('account-1','Account One'),('account-2','Account Two');
        INSERT INTO "user" VALUES ('operator-1','OMS Operator','operator@example.test');
        INSERT INTO workspace_account_user VALUES ('account-1','operator-1');
        GRANT SELECT ON workspace_account, workspace_account_user, "user" TO oms_overprivileged;
        GRANT SELECT ON "user" TO oms_diagnostic;
        INSERT INTO "user" VALUES ('actor-1','Workflow Operator','workflow@example.test');
        INSERT INTO site_setting VALUES ('siteTimezone','Asia/Saigon',NOW(),NOW());
        INSERT INTO workflow_run (id,"accountId","actorId",module,"featureKey","workflowKey","targetType","targetId",status,title,"createdAt","startedAt","durationMs",summary)
          VALUES ('parity-run','account-1','actor-1','IMPORT_EXPORT','import.test','import.run','ImportBatch','batch-parity','COMPLETED_WITH_ERRORS','Parity workflow','2000-01-01', '2000-01-01',12345,'{"rows":105}');
        INSERT INTO workflow_run_log (id,"workflowRunId",sequence,level,stage,event,status,message,"rowNumber","shopDomain","operationName","durationMs",metadata,"errorDetails","createdAt")
          SELECT 'parity-log-'||n,'parity-run',n,CASE WHEN n=105 THEN 'ERROR' ELSE 'INFO' END,'row','processed','SUCCESS','Message '||n,n,'parity.example','test.operation',100,jsonb_build_object('payload',repeat('x',20000),'accessToken','secret-value'),jsonb_build_object('code','ERROR-105'),'2000-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,105) n;
        CREATE TABLE import_batch(id text PRIMARY KEY,"workflowRunId" text,"importType" text,"fileName" text);
        CREATE TABLE import_uploaded_file("batchId" text PRIMARY KEY,"fileName" text,"mimeType" text,"storageType" text,"storageKey" text,"contentText" text);
        CREATE TABLE import_batch_row("batchId" text,"rowNumber" integer,payload jsonb);
        INSERT INTO import_batch VALUES ('batch-parity','parity-run','FRAUD_CHECK','original.csv');
        INSERT INTO import_uploaded_file VALUES ('batch-parity','original.csv','text/csv','DB_TEXT',NULL,'ORDER#' || chr(10) || 'ORDER-123' || chr(10));
        INSERT INTO import_batch_row VALUES ('batch-parity',1,'{"ORDER#":"ORDER-123","extra":"value"}');
        GRANT SELECT ON import_batch,import_uploaded_file,import_batch_row TO oms_diagnostic;

      `);
    } finally {
      await owner.end();
    }
  }

  const parsed = new URL(adminUrl);
  const port = Number(parsed.port);
  const diagnosticUrls = {
    oms_isolation_a: databaseUrl(
      adminUrl,
      "oms_isolation_a",
      "oms_diagnostic",
      "diagnostic_password"
    ),
    oms_isolation_b: databaseUrl(
      adminUrl,
      "oms_isolation_b",
      "oms_diagnostic",
      "diagnostic_password"
    ),
  };
  const connections = Object.fromEntries(
    DATABASES.map((database) => [
      database,
      {
        accountIds: ["account-1"],
        api: null,
        database: {
          host: parsed.hostname,
          name: database,
          password: "diagnostic_password",
          port,
          tls: false,
          user: "oms_diagnostic",
        },
        globalDiagnostics: false,
      },
    ])
  ) as PostgresFixture["connections"];

  return {
    adminUrl,
    connections,
    diagnosticUrls,
    overprivilegedUrl: databaseUrl(
      adminUrl,
      "oms_isolation_a",
      "oms_overprivileged",
      "overprivileged_password"
    ),
    port,
  };
}
