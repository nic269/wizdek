import type {
  FunctionFileInput,
  FunctionRuntime,
  ParamsSchema,
} from "../definition";
import { FunctionsError } from "../errors";
import {
  functionsDisabled,
  type RunnerSettings,
  runnerSettings,
} from "../keys";

export type RunnerRunStatus = "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELED";

/** Events of one run, as the runner agent streams them. */
export type RunnerEvent =
  | { type: "started" }
  | { data: string; stream: "stdout" | "stderr"; type: "output" }
  | {
      durationMs: number;
      error?: string;
      exitCode: number | null;
      oomKilled: boolean;
      result?: unknown;
      status: RunnerRunStatus;
      truncated: boolean;
      type: "exit";
    };

export interface RunnerRunRequest {
  env: Record<string, string>;
  files: FunctionFileInput[];
  memoryMb: number;
  paramOrder?: string[];
  params: Record<string, unknown>;
  runId: string;
  runtime: FunctionRuntime;
  timeoutSeconds: number;
}

export type RunnerInspectResult = { schema: ParamsSchema } | { error: string };

export interface RunnerHealth {
  ok: boolean;
  runtimes: { id: FunctionRuntime; image: string; ready: boolean }[];
}

/**
 * Where functions execute. The runner agent on its own VM is the only
 * implementation; another backend would implement the same four calls.
 */
export interface FunctionRunner {
  /** Stops a run. False when the runner has no such active run. */
  cancel(runId: string): Promise<boolean>;
  health(): Promise<RunnerHealth>;
  inspect(
    runtime: FunctionRuntime,
    source: string
  ): Promise<RunnerInspectResult>;
  /** Starts a run and yields its events; the last one is `exit`. */
  run(
    request: RunnerRunRequest,
    signal: AbortSignal
  ): AsyncIterable<RunnerEvent>;
}

const REQUEST_TIMEOUT_MS = 30_000;

const unavailable = (detail?: string) =>
  new FunctionsError(
    "RUNNER_UNAVAILABLE",
    detail
      ? `The function runner is unavailable: ${detail}`
      : "The function runner is unavailable."
  );

/** The agent's explanation; a refusal without a JSON body has none. */
const errorMessageOf = (response: Response): Promise<string | undefined> =>
  response.json().then(
    (body: { error?: unknown }) =>
      typeof body.error === "string" ? body.error : undefined,
    () => undefined
  );

/** Maps a refused request to an error the caller can show. */
const refusal = async (response: Response): Promise<FunctionsError> => {
  const message = await errorMessageOf(response);
  if (response.status === 429) {
    return new FunctionsError(
      "RUNNER_BUSY",
      "The function runner is busy with other runs. Try again shortly."
    );
  }
  if (response.status === 401) {
    return unavailable("it refused this server's token.");
  }
  if (response.status >= 500) {
    return unavailable(message);
  }
  return new FunctionsError(
    "INVALID_FILES",
    message ?? `The function runner refused the run (${response.status}).`
  );
};

async function* readLines(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      pending += decoder.decode(value, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim()) {
          yield line;
        }
        newline = pending.indexOf("\n");
      }
    }
    pending += decoder.decode();
    if (pending.trim()) {
      yield pending;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Talks to the runner agent over HTTP(S) with its bearer token. */
export const createHttpRunner = (settings: RunnerSettings): FunctionRunner => {
  const headers = {
    authorization: `Bearer ${settings.token}`,
    "content-type": "application/json",
  };
  const call = async (
    path: string,
    init: RequestInit & { signal?: AbortSignal }
  ): Promise<Response> => {
    try {
      return await fetch(`${settings.url}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (init.signal?.aborted) {
        throw error;
      }
      throw unavailable();
    }
  };

  return {
    async cancel(runId) {
      const response = await call(`/runs/${encodeURIComponent(runId)}`, {
        method: "DELETE",
      });
      return response.status === 204;
    },
    async health() {
      const response = await call("/health", { method: "GET" });
      if (!response.ok) {
        throw await refusal(response);
      }
      return (await response.json()) as RunnerHealth;
    },
    async inspect(runtime, source) {
      const response = await call("/inspect", {
        body: JSON.stringify({ runtime, source }),
        method: "POST",
      });
      if (!response.ok) {
        throw await refusal(response);
      }
      return (await response.json()) as RunnerInspectResult;
    },
    async *run(request, signal) {
      const response = await call("/runs", {
        body: JSON.stringify(request),
        method: "POST",
        signal,
      });
      if (!(response.ok && response.body)) {
        throw await refusal(response);
      }
      for await (const line of readLines(response.body)) {
        yield JSON.parse(line) as RunnerEvent;
      }
    },
  };
};

/** The configured runner; throws `FUNCTIONS_DISABLED` while none is set. */
export const getRunner = (): FunctionRunner => {
  const settings = runnerSettings();
  if (!settings) {
    throw functionsDisabled();
  }
  return createHttpRunner(settings);
};
