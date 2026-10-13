import { pathToFileURL } from "node:url";
import { prisma } from "./client";
import { syncSystemRoles } from "./system-roles";

export const seedDatabase = async (client = prisma) =>
  client.$transaction(async (transaction) => {
    await transaction.organization.upsert({
      create: { name: "Default Organization", slug: "default" },
      update: {},
      where: { slug: "default" },
    });

    const organizations = await transaction.organization.findMany({
      select: { id: true },
    });
    for (const existingOrganization of organizations) {
      await syncSystemRoles(transaction, existingOrganization.id);
    }
  });

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  seedDatabase()
    .then(() => prisma.$disconnect())
    .catch(async (error: unknown) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
