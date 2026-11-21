import {
  authenticateTrigger,
  type CodeFunctionRunRecord,
  createRateLimiter,
  FunctionsError,
  getTriggeredRun,
  invokeFunction,
} from "@repo/functions";
import { HTTP_TRIGGER } from "@repo/functions/definition";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const BEARER = /^Bearer\s+(.+)$/i;
const RETRY_AFTER_BUSY_SECONDS = 10;

const STATUS_OF_FAILURE: Partial<Record<string, ContentfulStatusCode>> = {
  DEPS_NOT_READY: 409,
  FUNCTIONS_DISABLED: 503,
  PARAMS_INVALID: 422,
  RUNNER_BUSY: 503,
  RUNNER_UNAVAILABLE: 503,
};

const tokenOf = (context: Context): string | null => {
  const header = context.req.header(HTTP_TRIGGER.header);
  if (header) {
    return header.trim();
  }
  const match = BEARER.exec(context.req.header("authorization") ?? "");
  return match?.[1]?.trim() ?? null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The params in the body: an empty body means none. */
const paramsOf = async (
  context: Context
): Promise<Record<string, unknown> | null> => {
  const text = await context.req.text();
  if (text.trim() === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** What a caller learns about a run: never its output. */
const answerOf = (run: CodeFunctionRunRecord) => {
  if (run.status === "SUCCEEDED") {
    return {
      body: {
        durationMs: run.durationMs,
        result: run.result,
        runId: run.id,
        status: run.status,
      },
      status: 200 as const,
    };
  }
  if (run.status === "QUEUED" || run.status === "RUNNING") {
    return {
      body: { runId: run.id, status: run.status },
      status: 202 as const,
    };
  }
  return {
    body: { error: run.error, runId: run.id, status: run.status },
    status: 500 as const,
  };
};

export interface FunctionTriggerOptions {
  /** How long a call waits for its run; shortened in tests. */
  waitMs?: number;
}

/**
 * The public HTTP trigger of functions. There is no session: the
 * per-function token is the only authorization, and every refusal of it is
 * the same empty 401, whether the function is unknown, its trigger is off or
 * the token is wrong. Responses carry the result or error, never output.
 */
export const createFunctionTriggerRoutes = (
  options: FunctionTriggerOptions = {}
) => {
  const limiter = createRateLimiter(HTTP_TRIGGER.requestsPerMinute);
  const routes = new Hono();

  routes.post(
    "/:functionId",
    bodyLimit({
      maxSize: HTTP_TRIGGER.bodyBytes,
      onError: (context) => context.body(null, 413),
    }),
    async (context) => {
      const fn = await authenticateTrigger(
        context.req.param("functionId"),
        tokenOf(context)
      );
      if (!fn) {
        return context.body(null, 401);
      }
      if (!limiter.allow(fn.id)) {
        context.header("Retry-After", String(limiter.retryAfterSeconds(fn.id)));
        return context.json({ error: "Too many requests." }, 429);
      }
      const params = await paramsOf(context);
      if (!params) {
        return context.json(
          { error: "Send the parameters as a JSON object." },
          422
        );
      }
      try {
        const outcome = await invokeFunction(fn, params, {
          ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
        });
        if (outcome.kind === "busy") {
          context.header("Retry-After", String(RETRY_AFTER_BUSY_SECONDS));
          return context.json(
            { error: outcome.run.error, runId: outcome.run.id },
            503
          );
        }
        const answer = answerOf(outcome.run);
        return context.json(answer.body, answer.status);
      } catch (error) {
        if (!(error instanceof FunctionsError)) {
          throw error;
        }
        const status = STATUS_OF_FAILURE[error.failure] ?? 409;
        if (status === 503) {
          context.header("Retry-After", String(RETRY_AFTER_BUSY_SECONDS));
        }
        return context.json({ error: error.message }, status);
      }
    }
  );

  routes.get("/:functionId/runs/:runId", async (context) => {
    const fn = await authenticateTrigger(
      context.req.param("functionId"),
      tokenOf(context)
    );
    if (!fn) {
      return context.body(null, 401);
    }
    const run = await getTriggeredRun(fn, context.req.param("runId"));
    if (!run) {
      return context.json({ error: "Run not found." }, 404);
    }
    // A failed run is still a successful lookup, so this answers 200.
    return context.json({
      durationMs: run.durationMs,
      error: run.error,
      result: run.status === "SUCCEEDED" ? run.result : null,
      runId: run.id,
      status: run.status,
    });
  });

  return routes;
};
