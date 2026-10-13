"use client";

import { apiClient } from "@repo/api/client";
import { useQuery } from "@tanstack/react-query";
import { isRunActive } from "../../../flow-labels";

export const RUN_POLL_INTERVAL_MS = 2000;

export type RunDetail = Awaited<
  ReturnType<typeof apiClient.flows.runs.get>
>["data"];

export const runQueryKey = (runId: string) => ["flow-run", runId] as const;

/**
 * Loads a run and keeps it fresh while it can still change. Polling stops
 * by itself once the run reaches a final status.
 */
export const useRunPolling = (runId: string) =>
  useQuery({
    queryFn: async () => (await apiClient.flows.runs.get({ runId })).data,
    queryKey: runQueryKey(runId),
    refetchInterval: (query) =>
      query.state.data && !isRunActive(query.state.data.run.status)
        ? false
        : RUN_POLL_INTERVAL_MS,
  });
