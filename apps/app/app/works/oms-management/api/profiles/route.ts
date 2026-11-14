import { randomUUID } from "node:crypto";
import { z } from "zod";
import { targetSchema } from "../../_module/lib/contracts";
import { guard, readBody } from "../../_module/server/http/guard";
import { limitConnectionTests } from "../../_module/server/profiles/rate-limit";
import { editSchema } from "../../_module/server/profiles/schema";
import {
  connectionFailure,
  databaseFromUrl,
  urlConnectionSchema,
} from "../../_module/server/profiles/url-connection";
import { profiles } from "../../_module/server/target/context";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  guard(request, ({ actor, config }) => {
    const params = new URL(request.url).searchParams;
    const repository = profiles(config);
    if (params.has("id")) {
      return Response.json(
        repository.editable(
          actor,
          targetSchema.parse({
            profileId: params.get("id"),
            revision: Number(params.get("revision")),
          })
        )
      );
    }
    return Response.json({ actor, profiles: repository.list(actor) });
  });
export const POST = (request: Request) =>
  guard(request, async ({ actor, config }) => {
    const input = z
      .object({
        action: z.enum(["save", "save-url", "disable", "reset"]),
        data: z.unknown(),
      })
      .parse(await readBody(request));
    const repository = profiles(config);
    limitConnectionTests(actor.id);
    if (input.action === "save-url") {
      const data = urlConnectionSchema.parse(input.data);
      try {
        return Response.json({
          profile: await repository.save(actor, {
            accountIds: [],
            api: data.api
              ? {
                  origin: data.api.origin,
                  token: { mode: "replace", value: data.api.token },
                }
              : null,
            database: databaseFromUrl(data.url),
            environment: data.environment,
            expectedRevision: 0,
            globalDiagnostics: true,
            id: `oms-${randomUUID()}`,
            name: data.name,
          }),
        });
      } catch (error) {
        connectionFailure(error);
      }
    }
    if (input.action === "disable") {
      repository.disable(actor, targetSchema.parse(input.data));
      return Response.json({ ok: true });
    }
    if (input.action === "reset") {
      return Response.json({
        profile: await repository.reset(actor, targetSchema.parse(input.data)),
      });
    }
    return Response.json({
      profile: await repository.save(actor, editSchema.parse(input.data)),
    });
  });
