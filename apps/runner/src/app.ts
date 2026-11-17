import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { stream } from "hono/streaming";
import { isAuthorized } from "./auth";
import { inspectPython } from "./inspect-python";
import { inspectTypeScript } from "./inspect-typescript";
import {
  inspectRequestSchema,
  type RunEvent,
  runRequestSchema,
} from "./protocol";
import {
  type RefusalCode,
  type Runner,
  RunRefusedError,
} from "./run-container";
import type { RuntimeImages } from "./runtime-images";

/** Room for 1 MB of source plus params, variables and JSON escaping. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const REFUSAL_STATUS: Record<RefusalCode, 409 | 422 | 429 | 503> = {
  BUSY: 429,
  DUPLICATE_RUN: 409,
  NO_ENTRY_FILE: 422,
  RUNTIME_NOT_READY: 503,
};

export interface RunnerAppDependencies {
  images: RuntimeImages;
  runner: Runner;
  token: string;
}

export const createRunnerApp = ({
  images,
  runner,
  token,
}: RunnerAppDependencies) => {
  const app = new Hono();

  app.get("/health", (context) =>
    context.json({
      ok: true,
      runtimes: images
        .list()
        .map(({ id, image, ready }) => ({ id, image, ready })),
    })
  );

  app.use("*", async (context, next) => {
    if (!isAuthorized(context.req.header("authorization"), token)) {
      return context.json({ error: "Unauthorized." }, 401);
    }
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (context) =>
        context.json({ error: "The request is too large." }, 413),
    })
  );

  app.post("/inspect", async (context) => {
    const parsed = inspectRequestSchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (!parsed.success) {
      return context.json({ error: "Invalid request." }, 422);
    }
    if (parsed.data.runtime === "NODE") {
      return context.json(inspectTypeScript(parsed.data.source));
    }
    const python = images.get("PYTHON");
    if (!python?.ready) {
      return context.json({ error: "The PYTHON runtime is not ready." }, 503);
    }
    return context.json(await inspectPython(python.image, parsed.data.source));
  });

  app.post("/runs", async (context) => {
    const parsed = runRequestSchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (!parsed.success) {
      return context.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        422
      );
    }
    const request = parsed.data;

    let execute: ReturnType<Runner["prepare"]>;
    try {
      execute = runner.prepare(request);
    } catch (error) {
      if (error instanceof RunRefusedError) {
        return context.json(
          { code: error.code, error: error.message },
          REFUSAL_STATUS[error.code]
        );
      }
      throw error;
    }

    context.header("Content-Type", "application/x-ndjson");
    return stream(context, async (output) => {
      // A caller that goes away no longer wants the run.
      output.onAbort(() => {
        runner.cancel(request.runId);
      });
      let written: Promise<unknown> = Promise.resolve();
      const emit = (event: RunEvent) => {
        // Chained so events are written in the order they were emitted.
        written = written
          .then(() => output.write(`${JSON.stringify(event)}\n`))
          .catch(() => undefined);
      };
      await execute(emit);
      await written;
    });
  });

  app.delete("/runs/:runId", (context) =>
    context.body(null, runner.cancel(context.req.param("runId")) ? 204 : 404)
  );

  return app;
};
