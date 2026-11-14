import { getConfig } from "../../_module/server/config";
import { controlStore } from "../../_module/server/storage/control-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = () => {
  try {
    controlStore(getConfig());
    return Response.json(
      { status: "ready" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }
};
