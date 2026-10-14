export type DatabaseToolsFailure =
  | "INVALID_URL"
  | "INVALID_NAME"
  | "UNSUPPORTED_ENGINE"
  | "CONNECTION_FAILED"
  | "CONNECTION_NOT_FOUND"
  | "CONNECTION_BUSY"
  | "NAME_TAKEN"
  | "BACKUP_NOT_FOUND"
  | "BACKUP_BUSY"
  | "BACKUP_NOT_READY"
  | "TOOL_NOT_FOUND"
  | "TOOL_TOO_OLD"
  | "TOOL_FAILED"
  | "ABORTED";

/**
 * A database tool request that cannot be carried out. The message is safe to
 * show: it never contains a connection URL or password.
 */
export class DatabaseToolsError extends Error {
  readonly failure: DatabaseToolsFailure;

  constructor(failure: DatabaseToolsFailure, message: string) {
    super(message);
    this.name = "DatabaseToolsError";
    this.failure = failure;
  }
}
