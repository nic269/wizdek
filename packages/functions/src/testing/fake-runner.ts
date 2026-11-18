import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { FunctionRuntime } from "../definition";
import type {
  RunnerEvent,
  RunnerInspectResult,
  RunnerRunRequest,
} from "../runner/client";

export interface FakeRunContext {
  /** Resolves once the run is canceled through `DELETE /runs/:id`. */
  canceled: Promise<void>;
  request: RunnerRunRequest;
  /** Aborts when the caller disconnects. */
  signal: AbortSignal;
}

/** The events one run streams, in order. */
export type FakeRunScript = (
  context: FakeRunContext
) => AsyncIterable<RunnerEvent> | Iterable<RunnerEvent>;

export type FakeInspect = (
  runtime: FunctionRuntime,
  source: string
) => RunnerInspectResult;

/** An `exit` event; fields default to a successful run. */
export const fakeExit = (
  fields: Partial<Extract<RunnerEvent, { type: "exit" }>> = {}
): RunnerEvent => ({
  durationMs: 5,
  exitCode: 0,
  oomKilled: false,
  status: "SUCCEEDED",
  truncated: false,
  type: "exit",
  ...fields,
});

/** A run that prints one line and returns `{ ok: true }`. */
export const succeed: FakeRunScript = function* () {
  yield { type: "started" };
  yield { data: "hello\n", stream: "stdout", type: "output" };
  yield fakeExit({ result: { ok: true } });
};

const MAIN = /main\s*\(([^)]*)\)/;
const PARAM = /(\w+)\s*:\s*(string|number|boolean)(?:\s*=\s*([^,]+))?/g;
const QUOTED = /^(["'])(.*)\1$/;

type SimpleType = "string" | "number" | "boolean";

/** A literal default such as `10`, `false` or `"x"`. */
const literal = (text: string): unknown => {
  const value = text.trim();
  if (value === "true" || value === "false") {
    return value === "true";
  }
  const quoted = QUOTED.exec(value);
  return quoted ? quoted[2] : Number(value);
};

/** Reads `main(a: string, b: number = 1)` style signatures, enough for tests. */
const defaultInspect: FakeInspect = (_runtime, source) => {
  const match = MAIN.exec(source);
  if (!match) {
    return { error: "No function named main was found." };
  }
  const properties: Record<string, { default?: unknown; type: SimpleType }> =
    {};
  const order: string[] = [];
  const required: string[] = [];
  for (const [, name, type, fallback] of (match[1] ?? "").matchAll(PARAM)) {
    if (!(name && type)) {
      continue;
    }
    properties[name] =
      fallback === undefined
        ? { type: type as SimpleType }
        : { default: literal(fallback), type: type as SimpleType };
    order.push(name);
    if (fallback === undefined) {
      required.push(name);
    }
  }
  return {
    schema: { properties, required, type: "object", "x-order": order },
  };
};

const readBody = async <T>(request: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") as T;
};

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const HEALTH = {
  ok: true,
  runtimes: [
    { id: "NODE", image: "fake", ready: true },
    { id: "PYTHON", image: "fake", ready: true },
  ],
};

/**
 * An in-process stand-in for the runner agent, speaking its HTTP protocol.
 * Tests change `state` to choose how runs and inspections behave, or to make
 * the runner refuse runs with an HTTP status.
 */
export const startFakeRunner = async ({
  port: requestedPort = 0,
  token = randomBytes(24).toString("hex"),
}: {
  port?: number;
  token?: string;
} = {}) => {
  const cancels = new Map<string, () => void>();
  const state = {
    canceledRunIds: [] as string[],
    inspect: defaultInspect,
    inspectCalls: 0,
    refuseWith: undefined as number | undefined,
    requests: [] as RunnerRunRequest[],
    script: succeed,
  };

  const inspect = async (
    request: IncomingMessage,
    response: ServerResponse
  ) => {
    state.inspectCalls += 1;
    const body = await readBody<{ runtime: FunctionRuntime; source: string }>(
      request
    );
    json(response, 200, state.inspect(body.runtime, body.source));
  };

  const cancel = (runId: string, response: ServerResponse) => {
    const stop = cancels.get(runId);
    if (!stop) {
      json(response, 404, { error: "No such run." });
      return;
    }
    state.canceledRunIds.push(runId);
    stop();
    response.writeHead(204).end();
  };

  const run = async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readBody<RunnerRunRequest>(request);
    state.requests.push(body);
    if (state.refuseWith) {
      json(response, state.refuseWith, { error: "Refused by the fake." });
      return;
    }
    const disconnected = new AbortController();
    response.on("close", () => disconnected.abort());
    const canceled = new Promise<void>((resolve) => {
      cancels.set(body.runId, resolve);
    });
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    try {
      const events = state.script({
        canceled,
        request: body,
        signal: disconnected.signal,
      });
      for await (const event of events) {
        if (disconnected.signal.aborted) {
          break;
        }
        if (!response.write(`${JSON.stringify(event)}\n`)) {
          await once(response, "drain");
        }
      }
    } finally {
      cancels.delete(body.runId);
      response.end();
    }
  };

  const route = (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> | undefined => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { error: "Unauthorized." });
      return;
    }
    const { pathname } = new URL(request.url ?? "/", "http://runner");
    const method = request.method ?? "GET";
    if (method === "GET" && pathname === "/health") {
      json(response, 200, HEALTH);
      return;
    }
    if (method === "POST" && pathname === "/inspect") {
      return inspect(request, response);
    }
    if (method === "POST" && pathname === "/runs") {
      return run(request, response);
    }
    if (method === "DELETE" && pathname.startsWith("/runs/")) {
      cancel(decodeURIComponent(pathname.slice("/runs/".length)), response);
      return;
    }
    json(response, 404, { error: "Not found." });
  };

  const server = createServer((request, response) => {
    Promise.resolve(route(request, response)).catch(() => {
      if (response.headersSent) {
        response.destroy();
      } else {
        json(response, 500, { error: "Fake runner failed." });
      }
    });
  });
  server.listen(requestedPort, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    /** Resets behaviour and recorded calls between tests. */
    reset() {
      state.canceledRunIds = [];
      state.inspect = defaultInspect;
      state.inspectCalls = 0;
      state.refuseWith = undefined;
      state.requests = [];
      state.script = succeed;
    },
    /** What the fake does and what it has seen; tests may change it. */
    state,
    token,
    url: `http://127.0.0.1:${port}`,
  };
};

export type FakeRunner = Awaited<ReturnType<typeof startFakeRunner>>;
