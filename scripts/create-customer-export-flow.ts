import { readFile } from "node:fs/promises";
import { prisma } from "../packages/database/src/index";
import {
  createFlow,
  flowDefinitionSchema,
  saveFlowVersion,
  validateDefinition,
} from "../packages/flows/src/index";

const [organizationId, actorId] = process.argv.slice(2);
if (!(organizationId && actorId)) {
  throw new Error(
    "Usage: dotenv -e .env -- tsx scripts/create-customer-export-flow.ts <organizationId> <actorId>"
  );
}
try {
  const member = await prisma.membership.findFirst({
    include: { role: true },
    where: { organizationId, status: "ACTIVE", userId: actorId },
  });
  if (!(member && ["Owner", "Admin"].includes(member.role?.name ?? ""))) {
    throw new Error("An active organization Owner or Admin is required.");
  }
  const definition = flowDefinitionSchema.parse(
    JSON.parse(
      await readFile(
        new URL("../docs/examples/customers-export.flow.json", import.meta.url),
        "utf8"
      )
    )
  );
  const validation = validateDefinition(definition);
  if (!validation.valid) {
    throw new Error(JSON.stringify(validation.issues));
  }
  const { flow } = await createFlow({
    actorId,
    description:
      "Configurable customer fields and search filters, mapped CSV columns, and persistent downloadable files.",
    name: "Export Shopify customers to CSV",
    organizationId,
  });
  const saved = await saveFlowVersion(
    { flowId: flow.id, organizationId },
    { actorId, baseVersion: 1, definition }
  );
  console.log(
    JSON.stringify({
      flowId: flow.id,
      validation: saved.validation,
      version: saved.version.version,
    })
  );
} finally {
  await prisma.$disconnect();
}
