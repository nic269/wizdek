import {
  DatabaseToolsError,
  type DatabaseToolsFailure,
} from "@repo/database-tools";
import { ApiError } from "../errors";

const FAILURE_RESPONSES: Record<
  DatabaseToolsFailure,
  { code: string; status: 404 | 409 | 422 | 500 }
> = {
  ABORTED: { code: "CONFLICT", status: 409 },
  BACKUP_BUSY: { code: "CONFLICT", status: 409 },
  BACKUP_NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  BACKUP_NOT_READY: { code: "CONFLICT", status: 409 },
  CONNECTION_BUSY: { code: "CONFLICT", status: 409 },
  CONNECTION_FAILED: { code: "VALIDATION_ERROR", status: 422 },
  CONNECTION_NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  INVALID_NAME: { code: "VALIDATION_ERROR", status: 422 },
  INVALID_URL: { code: "VALIDATION_ERROR", status: 422 },
  NAME_TAKEN: { code: "CONFLICT", status: 409 },
  TOOL_FAILED: { code: "INTERNAL_SERVER_ERROR", status: 500 },
  TOOL_NOT_FOUND: { code: "INTERNAL_SERVER_ERROR", status: 500 },
  TOOL_TOO_OLD: { code: "INTERNAL_SERVER_ERROR", status: 500 },
  UNSUPPORTED_ENGINE: { code: "VALIDATION_ERROR", status: 422 },
};

/** Runs a database tool call, turning its domain errors into API errors. */
export const withDatabaseErrors = async <T>(
  run: () => Promise<T>
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DatabaseToolsError) {
      const { code, status } = FAILURE_RESPONSES[error.failure];
      throw new ApiError(code, error.message, status, {
        reason: error.failure,
      });
    }
    throw error;
  }
};
