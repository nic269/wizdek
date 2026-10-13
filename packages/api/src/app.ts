import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { ORPCError, onError, ValidationError } from "@orpc/server";
import { auth } from "@repo/auth/server";
import { Hono } from "hono";
import { z } from "zod";
import { requestContext } from "./context";
import { ApiError, type ApiErrorResponse } from "./errors";
import { requireAuthEndpointEnabled } from "./feature-guards";
import { getOpenApiDocument } from "./openapi";
import { router } from "./routers";

const orpcHandler = new OpenAPIHandler(router, {
  clientInterceptors: [
    onError((error, options) => {
      if (
        error instanceof ORPCError &&
        error.code === "BAD_REQUEST" &&
        error.cause instanceof ValidationError
      ) {
        const zodError = new z.ZodError(
          error.cause.issues as z.core.$ZodIssue[]
        );
        throw new ApiError(
          "VALIDATION_ERROR",
          "Invalid request details.",
          422,
          z.flattenError(zodError),
          { cause: error.cause }
        );
      }

      if (
        !(error instanceof ORPCError) ||
        error.code === "INTERNAL_SERVER_ERROR"
      ) {
        const diagnosticError =
          error instanceof Error && error.cause instanceof Error
            ? error.cause
            : error;
        options.context.logger.error("api.unhandled_error", {
          errorMessage:
            diagnosticError instanceof Error
              ? diagnosticError.message
              : "Unknown error",
          errorStack:
            diagnosticError instanceof Error
              ? diagnosticError.stack
              : undefined,
        });
        throw new ApiError(
          "INTERNAL_SERVER_ERROR",
          "An unexpected error occurred.",
          500,
          undefined,
          { cause: diagnosticError }
        );
      }
    }),
  ],
  customErrorResponseBodyEncoder: (error) => ({
    error: {
      code: error.code,
      ...(error.data === undefined ? {} : { details: error.data }),
      message: error.message,
    },
  }),
});

const withRequestId = async (response: Response, requestId: string) => {
  if (response.status < 400) {
    return response;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  const body = await response
    .clone()
    .json()
    .catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    !("error" in body) ||
    !body.error ||
    typeof body.error !== "object"
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");

  return new Response(
    JSON.stringify({
      ...body,
      error: { ...body.error, requestId },
    }),
    {
      headers,
      status: response.status,
      statusText: response.statusText,
    }
  );
};

export const createApiApp = () => {
  const app = new Hono();

  app.use("*", requestContext);
  app.get("/openapi.json", async (context) =>
    context.json(await getOpenApiDocument())
  );
  app.get("/docs/api", (context) =>
    context.html("<html><body><pre>/openapi.json</pre></body></html>")
  );
  app.on(["GET", "POST"], "/api/auth/*", (context) => {
    requireAuthEndpointEnabled(context.req.path);
    return auth.handler(context.req.raw);
  });
  app.use("*", async (context, next) => {
    const { matched, response } = await orpcHandler.handle(context.req.raw, {
      context: {
        headers: context.req.raw.headers,
        logger: context.get("logger"),
        requestId: context.get("requestId"),
      },
    });

    if (matched) {
      const requestId = context.get("requestId");
      return withRequestId(response, requestId);
    }
    await next();
  });

  app.notFound((context) =>
    context.json<ApiErrorResponse>(
      {
        error: {
          code: "NOT_FOUND",
          message: "Route not found.",
          requestId: context.get("requestId"),
        },
      },
      404
    )
  );

  app.onError((error, context) => {
    const requestId = context.get("requestId");

    if (error instanceof ApiError) {
      context.get("logger").error(error.message, {
        code: error.code,
        details: error.details,
      });

      return context.json<ApiErrorResponse>(
        {
          error: {
            code: error.code,
            details: error.details,
            message: error.message,
            requestId,
          },
        },
        error.status as 500
      );
    }

    context.get("logger").error("api.unhandled_error", {
      errorMessage: error.message,
      errorStack: error.stack,
    });

    return context.json<ApiErrorResponse>(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred.",
          requestId,
        },
      },
      500
    );
  });

  return app;
};

export type ApiApp = ReturnType<typeof createApiApp>;
