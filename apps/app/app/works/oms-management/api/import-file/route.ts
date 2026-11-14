import { randomUUID } from "node:crypto";
import { targetSchema } from "../../_module/lib/contracts";
import { invariant } from "../../_module/server/errors";
import { guard } from "../../_module/server/http/guard";
import { workflowImportFile } from "../../_module/server/services/workflow-import-file";
import { profiles, readTarget } from "../../_module/server/target/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  guard(request, async ({ actor, config }) => {
    const params = new URL(request.url).searchParams;
    const ref = targetSchema.parse({
      profileId: params.get("profileId"),
      revision: Number(params.get("revision")),
    });
    const id = params.get("id");
    invariant(id && id.length <= 128, "invalid_id", "Workflow ID is required.");
    const repository = profiles(config);
    const operationId = randomUUID();
    const audit = (outcome: string) =>
      repository.store.audit(
        actor.id,
        ref.profileId,
        ref.revision,
        "download.original",
        { operationId, outcome, resourceId: id }
      );
    const file = await readTarget(
      actor,
      ref,
      config,
      "logs",
      async (db, connection) => {
        audit("attempted");
        try {
          const result = await workflowImportFile(db, connection, id);
          audit("succeeded");
          return result;
        } catch (error) {
          audit("failed");
          throw error;
        }
      }
    );
    return new Response(new Uint8Array(file.content), {
      headers: {
        "Content-Disposition": file.disposition,
        "Content-Type": file.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
