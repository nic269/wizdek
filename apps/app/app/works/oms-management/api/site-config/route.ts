import { targetSchema } from "../../_module/lib/contracts";
import { guard } from "../../_module/server/http/guard";
import { siteConfig } from "../../_module/server/services/site-config";
import { readTarget } from "../../_module/server/target/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  guard(request, async ({ actor, config }) => {
    const params = new URL(request.url).searchParams;
    const target = targetSchema.parse({
      profileId: params.get("profileId"),
      revision: Number(params.get("revision")),
    });
    const data = await readTarget(
      actor,
      target,
      config,
      "health",
      (db, connection) => siteConfig(db, connection, config)
    );
    return Response.json({ data, target });
  });
