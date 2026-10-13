import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["db:migrate:status"], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  console.error(
    "Database migrations are not ready. Inspect the status above. For pending or uninitialized migrations, run `pnpm db:migrate:deploy`; repair failed migrations before retrying."
  );
  process.exit(result.status ?? 1);
}
