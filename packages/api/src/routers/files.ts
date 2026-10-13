import { uploadFlowFile } from "@repo/flows";
import { getStorageProviderStatus } from "@repo/storage";
import { requireOrganizationAccess } from "./authz";
import { withFlowErrors } from "./flow-errors";
import { os } from "./implementer";

export const filesRouter = {
  status: os.files.status.handler(() => ({
    data: getStorageProviderStatus(),
    message: "Storage providers are configured through @repo/storage.",
  })),
  upload: os.files.upload.handler(async ({ context, input }) => {
    const user = await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "flows",
      "run"
    );
    const file = await withFlowErrors(async () =>
      uploadFlowFile({
        actorId: user.id,
        body: new Uint8Array(await input.file.arrayBuffer()),
        contentType: input.file.type,
        fileName: input.file.name,
        organizationId: input.organizationId,
      })
    );
    return { data: file };
  }),
};
