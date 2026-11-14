import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../../../../..");
const snapshot = mkdtempSync(resolve(tmpdir(), "wizdek-without-oms-"));
const files = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" }
)
  .split("\0")
  .filter(Boolean);
for (const file of files) {
  if (
    file.startsWith("apps/app/app/works/oms-management/") ||
    file.startsWith("apps/app/app/oms/") ||
    file === "apps/app/app/works/page.tsx" ||
    file === ".github/workflows/oms-management.yml" ||
    /(^|\/)\.env(?:\.|$)/.test(file) ||
    file.startsWith("plans/")
  ) {
    continue;
  }
  const source = resolve(root, file);
  if (!existsSync(source)) {
    continue;
  }
  const destination = resolve(snapshot, file);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}
const navPath = resolve(snapshot, "packages/config/src/navigation.ts");
writeFileSync(
  navPath,
  readFileSync(navPath, "utf8").replace(
    /\s*\/\/ OMS_NAV_START[\s\S]*?\/\/ OMS_NAV_END\n/,
    "\n"
  )
);
const navTestPath = resolve(snapshot, "packages/config/src/navigation.test.ts");
writeFileSync(
  navTestPath,
  readFileSync(navTestPath, "utf8")
    .replace(/\/\/ OMS_NAV_TEST_START[\s\S]*?\/\/ OMS_NAV_TEST_END\n/, "")
    .replace(/\s*"Works",/g, "")
);
const appManifestPath = resolve(snapshot, "apps/app/package.json");
const appManifest = JSON.parse(readFileSync(appManifestPath, "utf8"));
for (const name of Object.keys(appManifest.scripts)) {
  if (name.includes("oms")) {
    delete appManifest.scripts[name];
  }
}
writeFileSync(appManifestPath, `${JSON.stringify(appManifest, null, 2)}\n`);
const env: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("OMS_"))
  ),
  NODE_ENV: process.env.NODE_ENV ?? "production",
};
env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/wizdek";
env.BETTER_AUTH_SECRET = "removal-rehearsal-fake-secret-not-for-use";
env.BETTER_AUTH_URL = "http://127.0.0.1:4000";
env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:4000";
env.NEXT_PUBLIC_WEB_URL = "http://127.0.0.1:4000";
env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:3002";
env.NEXT_TELEMETRY_DISABLED = "1";
function run(args: string[]) {
  execFileSync("pnpm", args, {
    cwd: snapshot,
    env: {
      ...env,
      NODE_ENV: args.includes("test:unit") ? "test" : "production",
    },
    stdio: "inherit",
  });
}
console.log("Disposable removal snapshot:", snapshot);
try {
  run(["install", "--ignore-scripts", "--frozen-lockfile"]);
  run(["boundaries"]);
  run(["--filter", "@repo/database", "generate"]);
  run(["--filter", "@repo/auth", "check-types"]);
  run(["--filter", "@repo/api", "check-types"]);
  run(["--filter", "@repo/auth", "test:unit"]);
  run(["--filter", "@repo/api", "test:unit"]);
  run(["--filter", "@repo/app", "build"]);
  console.log(
    "Removal rehearsal passed; no OMS runtime variables were supplied."
  );
} finally {
  if (process.env.OMS_KEEP_REMOVAL_SNAPSHOT !== "true") {
    rmSync(snapshot, { force: true, recursive: true });
  }
}
