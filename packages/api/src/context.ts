import { createLogger } from "@repo/logger";
import type { Context, Next } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    logger: ReturnType<typeof createLogger>;
    requestId: string;
  }
}

export interface ApiContext {
  headers: Headers;
  logger: ReturnType<typeof createLogger>;
  requestId: string;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const sanitizeRequestId = (supplied?: string) =>
  supplied && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : crypto.randomUUID();

export const requestContext = async (context: Context, next: Next) => {
  const requestId = sanitizeRequestId(context.req.header("x-request-id"));
  const startedAt = performance.now();

  context.set("requestId", requestId);
  context.set("logger", createLogger({ requestId, route: context.req.path }));
  context.header("x-request-id", requestId);

  let nextRejected = false;
  try {
    await next();
  } catch (error) {
    nextRejected = true;
    throw error;
  } finally {
    context.get("logger").info("api.request", {
      durationMs: Math.round(performance.now() - startedAt),
      statusCode: nextRejected ? 500 : context.res.status,
    });
  }
};
