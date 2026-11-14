import { targetSchema } from "../../_module/lib/contracts";
import { invariant } from "../../_module/server/errors";
import { guard } from "../../_module/server/http/guard";
import {
  accountOptions,
  maintenance,
  overview,
  workflowBundle,
  workflowDetail,
  workflowOptions,
  workflowRuns,
} from "../../_module/server/services/diagnostics";
import { readTarget } from "../../_module/server/target/context";
export const runtime = "nodejs";

import { cronWithCatalog } from "../../_module/server/services/cron-catalog";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  guard(request, async ({ actor, config }) => {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    const ref = targetSchema.parse({
      profileId: params.profileId,
      revision: Number(params.revision),
    });
    const resource = params.resource ?? "overview";
    invariant(
      [
        "overview",
        "logs",
        "log",
        "cron",
        "maintenance",
        "accounts",
        "log-options",
        "log-bundle",
      ].includes(resource),
      "invalid_resource",
      "Unknown diagnostic resource."
    );
    let feature = resource;
    if (resource === "overview") {
      feature = "health";
    } else if (["log", "log-options", "log-bundle"].includes(resource)) {
      feature = "logs";
    }
    const data = await readTarget(
      actor,
      ref,
      config,
      feature,
      (db, connection) => {
        switch (resource) {
          case "accounts":
            return accountOptions(db, connection);
          case "overview":
            return overview(db, connection);
          case "logs":
            return workflowRuns(db, connection, params);
          case "log-options":
            return workflowOptions(db, connection);
          case "cron":
            return cronWithCatalog(db, connection, config);
          case "log":
          case "log-bundle": {
            invariant(
              params.id && params.id.length <= 128,
              "invalid_id",
              "Workflow ID is required."
            );
            if (resource === "log-bundle") {
              return workflowBundle(db, connection, params.id);
            }
            const after = Number(params.after ?? 0);
            invariant(
              Number.isSafeInteger(after) && after >= 0,
              "invalid_cursor",
              "Invalid log cursor."
            );
            return workflowDetail(db, connection, params.id, after);
          }
          default:
            break;
        }
        return maintenance(db, connection);
      }
    );
    return Response.json({ data, target: ref });
  });
