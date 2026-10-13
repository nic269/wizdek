import { pathToFileURL } from "node:url";
import { prisma } from "./client";
import { syncSystemRoles } from "./system-roles";

/**
 * Re-applies the system role presets to every organization. Roles are
 * otherwise synced only when an organization is created or seeded, so run
 * this after the permission catalog or a preset changes.
 */
export const syncAllSystemRoles = async (client = prisma): Promise<number> => {
  const organizations = await client.organization.findMany({
    select: { id: true },
  });
  for (const organization of organizations) {
    await client.$transaction((transaction) =>
      syncSystemRoles(transaction, organization.id)
    );
  }
  return organizations.length;
};

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  syncAllSystemRoles()
    .then(async (count) => {
      console.log(`Synced system roles for ${count} organization(s).`);
      await prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
