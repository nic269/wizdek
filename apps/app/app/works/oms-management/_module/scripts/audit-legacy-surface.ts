import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const [, , repository] = process.argv;
if (!repository) {
  throw new Error(
    "Usage: tsx scripts/audit-legacy-surface.ts /path/to/oms-repo"
  );
}
const output = execFileSync(
  "rg",
  [
    "-n",
    "-m",
    "100",
    "G_ADMINISTRATOR|requiresGod|MANAGE_SITE_CONFIG|requireGlobalAdministrator",
    "apps",
    "packages",
    "-g",
    "*.ts",
    "-g",
    "*.tsx",
    "-g",
    "*.prisma",
    "-g",
    "!*.test.ts",
    "-g",
    "!**/generated/**",
  ],
  { cwd: resolve(repository), encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }
);
console.log(`# Legacy privilege references — read-only inventory\n\n${output}`);
console.log(
  "\nNo roles, assignments or routes were modified. Map each reference to verified replacement evidence before cutover."
);
