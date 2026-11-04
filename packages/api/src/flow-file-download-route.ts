import { Readable } from "node:stream";
import { prisma } from "@repo/database";
import { getStorageProvider } from "@repo/storage";
import type { Context } from "hono";
import { ApiError } from "./errors";
import { requireRunPermission } from "./routers/authz";

export const handleFlowFileDownload = async (context: Context) => {
  const { run } = await requireRunPermission(
    context.req.raw.headers,
    context.req.param("runId") ?? "",
    "read"
  );
  const file = await prisma.fileAsset.findFirst({
    where: {
      AND: [
        { metadata: { equals: "flow-export", path: ["purpose"] } },
        { metadata: { equals: run.id, path: ["runId"] } },
      ],
      deletedAt: null,
      id: context.req.param("assetId") ?? "",
      organizationId: run.organizationId,
    },
  });
  if (!file) {
    throw new ApiError("NOT_FOUND", "Export file not found.", 404);
  }
  const object = await getStorageProvider().getObjectStream({
    key: file.objectKey,
  });
  return new Response(
    Readable.toWeb(object.body) as ReadableStream<Uint8Array>,
    {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "content-length": String(object.sizeBytes),
        "content-type": "text/csv; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    }
  );
};
