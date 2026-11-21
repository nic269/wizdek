import { startFakeRunner } from "./fake-runner";

/**
 * Runs the fake runner as its own process for the browser test suite.
 * FAKE_RUNNER_PORT picks the port and FAKE_RUNNER_TOKEN the bearer token the
 * API must send.
 */
const token = process.env.FAKE_RUNNER_TOKEN;
if (!token) {
  throw new Error("FAKE_RUNNER_TOKEN is required.");
}
const runner = await startFakeRunner({
  port: Number(process.env.FAKE_RUNNER_PORT ?? 3998),
  token,
});
console.log(`Fake runner listening on ${runner.url}`);

const shutdown = () => {
  runner.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
