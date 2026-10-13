import { FlowServiceError, type FlowServiceFailure } from "@repo/flows";
import { ApiError } from "../errors";

const FAILURE_RESPONSES: Record<
  FlowServiceFailure,
  { code: string; status: 404 | 409 | 422 }
> = {
  ACTIVATION_INVALID: { code: "VALIDATION_ERROR", status: 422 },
  DEFINITION_INVALID: { code: "VALIDATION_ERROR", status: 422 },
  FLOW_INVALID: { code: "VALIDATION_ERROR", status: 422 },
  FLOW_NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  INPUT_INVALID: { code: "VALIDATION_ERROR", status: 422 },
  RUN_NOT_CANCELABLE: { code: "CONFLICT", status: 409 },
  RUN_NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  STORE_NOT_AVAILABLE: { code: "VALIDATION_ERROR", status: 422 },
  UPLOAD_REJECTED: { code: "VALIDATION_ERROR", status: 422 },
  VERSION_CONFLICT: { code: "CONFLICT", status: 409 },
};

/** Runs a flow service call, turning its domain errors into API errors. */
export const withFlowErrors = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FlowServiceError) {
      const { code, status } = FAILURE_RESPONSES[error.failure];
      throw new ApiError(code, error.message, status, {
        reason: error.failure,
        ...(error.issues ? { issues: error.issues } : {}),
      });
    }
    throw error;
  }
};
