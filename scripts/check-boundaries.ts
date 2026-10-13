import { join } from "node:path";
import { checkBoundaries } from "./boundaries/boundary-engine.ts";

const root = process.cwd();
const violations = await checkBoundaries({
  configPath: join(root, "boundaries.config.json"),
  root,
});

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(
      `${violation.file ?? "workspace"}: [${violation.code}] ${violation.message}`
    );
  }
  process.exit(1);
}

console.log("Boundary check passed.");
