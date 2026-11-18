"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { isActiveRunStatus } from "@repo/functions/definition";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

export type FunctionRunSummary = Awaited<
  ReturnType<typeof apiClient.functionRuns.start>
>["data"];

export const RUN_POLL_INTERVAL_MS = 1000;
/** Slower retries after a failed poll, so a hiccup does not flood the API. */
const RETRY_INTERVAL_MS = 3000;
const HISTORY_PAGE_SIZE = 20;

type RunsPage = Awaited<ReturnType<typeof apiClient.functionRuns.list>>;

export const functionRunsKey = (functionId: string) =>
  ["function-runs", functionId] as const;

/** A function's past runs, newest first, a page at a time. */
export const useFunctionRuns = (functionId: string) =>
  useInfiniteQuery({
    getNextPageParam: (last: RunsPage) => last.pageInfo.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      await apiClient.functionRuns.list({
        cursor: pageParam,
        functionId,
        limit: HISTORY_PAGE_SIZE,
      }),
    queryKey: functionRunsKey(functionId),
  });

/**
 * Follows one run: polls it every second while it is queued or running and
 * asks only for the output it has not seen yet.
 */
export const useFunctionRun = (functionId: string) => {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<FunctionRunSummary | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);

  const refreshHistory = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: functionRunsKey(functionId) }),
    [functionId, queryClient]
  );

  useEffect(() => {
    if (!runId) {
      return;
    }
    let stopped = false;
    let offset = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setOutput("");

    const poll = async () => {
      try {
        const { data } = await apiClient.functionRuns.get({
          outputOffset: offset,
          runId,
        });
        if (stopped) {
          return;
        }
        const { output: tail, outputLength, ...summary } = data;
        offset = outputLength;
        if (tail) {
          setOutput((current) => current + tail);
        }
        setRun(summary);
        setError(null);
        if (isActiveRunStatus(summary.status)) {
          timer = setTimeout(poll, RUN_POLL_INTERVAL_MS);
        } else {
          refreshHistory();
        }
      } catch (cause) {
        if (stopped) {
          return;
        }
        setError(getApiErrorMessage(cause, "Could not load the run."));
        timer = setTimeout(poll, RETRY_INTERVAL_MS);
      }
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refreshHistory, runId]);

  /** Starts a run of the saved source; resolves false when it was refused. */
  const start = useCallback(
    async (params: Record<string, unknown>) => {
      setStartError(null);
      setIsStarting(true);
      try {
        const { data } = await apiClient.functionRuns.start({
          functionId,
          params,
        });
        setRun(data);
        setRunId(data.id);
        refreshHistory();
        return true;
      } catch (cause) {
        setStartError(getApiErrorMessage(cause, "Could not start the run."));
        return false;
      } finally {
        setIsStarting(false);
      }
    },
    [functionId, refreshHistory]
  );

  const cancel = useCallback(async () => {
    if (!runId) {
      return;
    }
    setIsCanceling(true);
    try {
      const { data } = await apiClient.functionRuns.cancel({ runId });
      setRun(data);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not stop the run."));
    } finally {
      setIsCanceling(false);
    }
  }, [runId]);

  /** Shows a past run in place of the current one. */
  const select = useCallback((id: string) => {
    setRun(null);
    setRunId(id);
  }, []);

  return {
    cancel,
    error,
    isActive: run ? isActiveRunStatus(run.status) : false,
    isCanceling,
    isStarting,
    output,
    run,
    runId,
    select,
    start,
    startError,
  };
};

export type FunctionRunState = ReturnType<typeof useFunctionRun>;
