import { getStorageProviderStatus } from "@repo/storage";
import { os } from "./implementer";

export const filesRouter = {
  status: os.files.status.handler(() => ({
    data: getStorageProviderStatus(),
    message: "Storage providers are configured through @repo/storage.",
  })),
};
