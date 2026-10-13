import { createPgBossJobProvider } from "../src/providers/pg-boss";

/**
 * Stands in for a worker process that dies mid-job: it takes a job, reports
 * that it started, and never finishes. The test kills this process outright.
 * Arguments: schema, job name, retry attempts.
 */
const [schema, name, attempts] = process.argv.slice(2);
if (!(schema && name && process.env.DATABASE_URL)) {
  throw new Error("Usage: hanging-worker <schema> <job name> [attempts]");
}

const provider = createPgBossJobProvider({
  connectionString: process.env.DATABASE_URL,
  pollingIntervalSeconds: 0.5,
  schema,
});
provider.register({
  handler: (_payload, { runId }) => {
    console.log(`STARTED ${runId}`);
    return new Promise<void>(() => {
      // Never settles.
    });
  },
  heartbeatSeconds: 10,
  name,
  retry: { attempts: Number(attempts ?? 2), delayMs: 0 },
  serialPerKey: true,
});
await provider.start();
console.log("READY");
