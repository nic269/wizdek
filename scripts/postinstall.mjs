import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const prismaSchemaPath = "packages/database/prisma/schema.prisma";

if (!existsSync(prismaSchemaPath)) {
  console.log(
    `Skipping Prisma generation because ${prismaSchemaPath} is not present.`
  );
  process.exit(0);
}

const result = spawnSync("pnpm", ["db:generate"], {
  shell: true,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
