import {
  createORPCErrorFromJson,
  isORPCErrorJson,
  ORPCError,
} from "@orpc/client";

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    details?: unknown;
    message?: string;
  };
}

export const decodeApiError = (body: unknown, response: { status: number }) => {
  if (isORPCErrorJson(body)) {
    return createORPCErrorFromJson(body);
  }

  const envelope = body as ApiErrorEnvelope;
  if (envelope?.error?.code && envelope.error.message) {
    return new ORPCError(envelope.error.code, {
      data: envelope.error.details,
      message: envelope.error.message,
      status: response.status,
    });
  }

  return null;
};

export const getApiErrorMessage = (
  error: unknown,
  fallback = "Request failed."
) => (error instanceof Error ? error.message : fallback);

export const getApiErrorCode = (error: unknown) =>
  error instanceof ORPCError ? error.code : undefined;
