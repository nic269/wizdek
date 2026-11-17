import { FunctionsError, type FunctionsFailure } from "@repo/functions";
import { ApiError } from "../errors";

const FAILURE_RESPONSES: Record<
  FunctionsFailure,
  { code: string; status: 404 | 409 | 422 | 503 }
> = {
  FUNCTION_NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  FUNCTIONS_DISABLED: { code: "CONFLICT", status: 409 },
  INVALID_FILES: { code: "VALIDATION_ERROR", status: 422 },
  INVALID_NAME: { code: "VALIDATION_ERROR", status: 422 },
  INVALID_SETTINGS: { code: "VALIDATION_ERROR", status: 422 },
  NAME_TAKEN: { code: "CONFLICT", status: 409 },
  PARAMS_INVALID: { code: "VALIDATION_ERROR", status: 422 },
  RUN_NOT_ACTIVE: { code: "CONFLICT", status: 409 },
  RUN_NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  RUNNER_BUSY: { code: "SERVICE_UNAVAILABLE", status: 503 },
  RUNNER_UNAVAILABLE: { code: "SERVICE_UNAVAILABLE", status: 503 },
  SOURCE_CONFLICT: { code: "CONFLICT", status: 409 },
};

/**
 * Runs a functions call, turning its domain errors into API errors. The
 * failure is passed on as `reason`, e.g. `FUNCTIONS_DISABLED`.
 */
export const withFunctionErrors = async <T>(
  run: () => Promise<T>
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FunctionsError) {
      const { code, status } = FAILURE_RESPONSES[error.failure];
      throw new ApiError(code, error.message, status, {
        reason: error.failure,
      });
    }
    throw error;
  }
};
