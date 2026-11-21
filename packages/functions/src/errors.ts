export type FunctionsFailure =
  | "FUNCTIONS_DISABLED"
  | "FUNCTION_NOT_FOUND"
  | "RUN_NOT_FOUND"
  | "NAME_TAKEN"
  | "INVALID_NAME"
  | "INVALID_SETTINGS"
  | "INVALID_FILES"
  | "SOURCE_CONFLICT"
  | "PARAMS_INVALID"
  | "RUNNER_UNAVAILABLE"
  | "RUNNER_BUSY"
  | "RUN_NOT_ACTIVE"
  | "DEPS_NOT_READY"
  | "DEPS_MISSING"
  | "INVALID_ENV_VAR"
  | "ENV_VAR_NOT_FOUND"
  | "INVALID_SCHEDULE"
  | "SCHEDULE_NOT_FOUND"
  | "SCHEDULES_UNAVAILABLE";

/**
 * A functions request that cannot be carried out. The message is safe to
 * show: it never contains source, parameter values or the runner token.
 */
export class FunctionsError extends Error {
  readonly failure: FunctionsFailure;

  constructor(failure: FunctionsFailure, message: string) {
    super(message);
    this.name = "FunctionsError";
    this.failure = failure;
  }
}

export const functionNotFound = () =>
  new FunctionsError("FUNCTION_NOT_FOUND", "Function not found.");

export const runNotFound = () =>
  new FunctionsError("RUN_NOT_FOUND", "Run not found.");

export const scheduleNotFound = () =>
  new FunctionsError("SCHEDULE_NOT_FOUND", "Schedule not found.");
