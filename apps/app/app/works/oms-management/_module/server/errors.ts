export class ManagementError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function invariant(
  condition: unknown,
  code: string,
  message: string,
  status = 400
): asserts condition {
  if (!condition) {
    throw new ManagementError(code, message, status);
  }
}
