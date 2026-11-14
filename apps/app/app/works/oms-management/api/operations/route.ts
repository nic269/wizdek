import { z } from "zod";
import { targetSchema } from "../../_module/lib/contracts";
import {
  execute,
  history,
  operationSchema,
  prepare,
  prepareRestore,
  reconcile,
} from "../../_module/server/audit/operations";
import { guard, readBody } from "../../_module/server/http/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  guard(request, ({ actor, config }) => {
    const params = new URL(request.url).searchParams;
    return Response.json({
      operations: history(
        actor,
        targetSchema.parse({
          profileId: params.get("profileId"),
          revision: Number(params.get("revision")),
        }),
        config
      ),
    });
  });
export const POST = (request: Request) =>
  guard(request, async ({ actor, config }) => {
    const input = z
      .discriminatedUnion("kind", [
        z.object({ data: operationSchema, kind: z.literal("prepare") }),
        z.object({
          acknowledgement: z.string().max(100),
          confirmation: z.string().max(100),
          kind: z.literal("execute"),
          operationId: z.string().uuid(),
        }),
        z.object({
          kind: z.literal("reconcile"),
          operationId: z.string().uuid(),
        }),
        z.object({
          kind: z.literal("restore"),
          operationId: z.string().uuid(),
        }),
      ])
      .parse(await readBody(request));
    if (input.kind === "prepare") {
      return Response.json(await prepare(actor, input.data, config));
    }
    if (input.kind === "execute") {
      return Response.json(
        await execute(
          actor,
          input.operationId,
          input.confirmation,
          input.acknowledgement,
          config
        )
      );
    }
    if (input.kind === "restore") {
      return Response.json(
        await prepareRestore(actor, input.operationId, config)
      );
    }
    return Response.json(await reconcile(actor, input.operationId, config));
  });
