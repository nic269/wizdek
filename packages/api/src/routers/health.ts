import { ApiError } from "../errors";
import { getHealthPayload, getReadyPayload, getStatusPayload } from "../health";
import { os } from "./implementer";

const health = os.health.health.handler(() => getHealthPayload());
const requireReadyPayload = async () => {
  const payload = await getReadyPayload();
  if (!payload.ok) {
    throw new ApiError(
      "SERVICE_UNAVAILABLE",
      "API is not ready to accept traffic.",
      503,
      { checks: payload.checks, providers: payload.providers }
    );
  }
  return { ...payload, ok: true as const };
};

const ready = os.health.ready.handler(() => requireReadyPayload());
const status = os.health.status.handler(() => getStatusPayload());

export const healthRouter = {
  health,
  ready,
  status,
};
