import { ORPCError } from "@orpc/server";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export class ApiError extends ORPCError<string, unknown> {
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    status: ContentfulStatusCode = 400,
    details?: unknown,
    options?: ErrorOptions
  ) {
    super(code, {
      data: details,
      message,
      status,
      ...(options?.cause ? { cause: options.cause } : {}),
    });
    this.details = details;
  }
}
