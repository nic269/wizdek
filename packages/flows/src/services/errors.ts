import type { FlowIssue } from "../definition/validate";

export type FlowServiceFailure =
  | "FLOW_NOT_FOUND"
  | "RUN_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "DEFINITION_INVALID"
  | "FLOW_INVALID"
  | "STORE_NOT_AVAILABLE"
  | "INPUT_INVALID"
  | "RUN_NOT_CANCELABLE"
  | "UPLOAD_REJECTED";

/** A flow or run request that cannot be carried out, with a reason a caller can act on. */
export class FlowServiceError extends Error {
  readonly failure: FlowServiceFailure;
  readonly issues: FlowIssue[] | undefined;

  constructor(
    failure: FlowServiceFailure,
    message: string,
    issues?: FlowIssue[]
  ) {
    super(message);
    this.name = "FlowServiceError";
    this.failure = failure;
    this.issues = issues;
  }
}
