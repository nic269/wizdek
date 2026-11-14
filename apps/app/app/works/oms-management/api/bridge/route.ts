import { randomUUID } from "node:crypto";
import { z } from "zod";
import { targetSchema } from "../../_module/lib/contracts";
import { invariant } from "../../_module/server/errors";
import { guard, readBody } from "../../_module/server/http/guard";
import {
  directCatalog,
  directReveal,
} from "../../_module/server/services/direct-reads";
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
    const data = await readTarget(actor, ref, config, "health", directCatalog);
    return Response.json({ data });
  });
export const POST = (request: Request) =>
  guard(request, async ({ actor, config }) => {
    const input = targetSchema
      .extend({
        accountId: z.string().min(1),
        action: z.enum([
          "shopify.token.reveal",
          "shopify.signature.reveal",
          "download.original",
        ]),
        payload: z.record(z.string(), z.unknown()),
      })
      .parse(await readBody(request));
    const repository = profiles(config);
    const secret = input.action.endsWith(".reveal");
    repository.resolve(actor, input, secret ? "secrets:reveal" : "read");
    const operationId = randomUUID();
    const data = await readTarget(
      actor,
      input,
      config,
      "health",
      async (db, connection) => {
        invariant(
          connection.globalDiagnostics ||
            connection.accountIds.includes(input.accountId),
          "account_denied",
          "Account is not in this connection scope.",
          403
        );
        repository.store.audit(
          actor.id,
          input.profileId,
          input.revision,
          input.action,
          {
            accountId: input.accountId,
            operationId,
            outcome: "attempted",
            resourceId: String(
              input.payload.storeId ?? input.payload.id ?? ""
            ).slice(0, 128),
          }
        );
        let result: unknown;
        try {
          if (secret) {
            result = await directReveal(
              db,
              connection,
              input.action,
              input.accountId,
              input.payload
            );
          } else if (input.action === "download.original") {
            result = await workflowImportFile(
              db,
              connection,
              String(input.payload.id ?? ""),
              input.accountId
            );
          }
        } catch (error) {
          repository.store.audit(
            actor.id,
            input.profileId,
            input.revision,
            input.action,
            {
              accountId: input.accountId,
              operationId,
              outcome: "failed",
              resourceId: String(
                input.payload.storeId ?? input.payload.id ?? ""
              ).slice(0, 128),
            }
          );
          throw error;
        }
        repository.store.audit(
          actor.id,
          input.profileId,
          input.revision,
          input.action,
          {
            accountId: input.accountId,
            operationId,
            outcome: "succeeded",
            resourceId: String(
              input.payload.storeId ?? input.payload.id ?? ""
            ).slice(0, 128),
          }
        );
        return result;
      }
    );
    if (secret) {
      return Response.json(data);
    }
    const file = data as {
      content: Buffer;
      contentType: string;
      disposition: string;
    };
    return new Response(new Uint8Array(file.content), {
      headers: {
        "Content-Disposition": file.disposition,
        "Content-Type": file.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
