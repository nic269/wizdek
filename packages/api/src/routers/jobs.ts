import { getJobProviderStatus } from "@repo/jobs";
import { os } from "./implementer";

export const jobsRouter = {
  status: os.jobs.status.handler(() => ({
    data: getJobProviderStatus(),
    message: "Job providers are configured through @repo/jobs.",
  })),
};
