"use client";

import { Button, RefreshCw } from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Actor, PublicProfile, TargetRef } from "../lib/contracts";
import { queryKey } from "../lib/contracts";
import { LogFilters, type LogFilterValues } from "./log-filters";
import { request } from "./management-app";
import { CheckboxField, ErrorNotice, Panel } from "./oms-ui";
import { WorkflowRunDetailPanel } from "./workflow-run-detail";
import {
  formatDuration,
  formatLogDate,
  formatLogLabel,
  type WorkflowRun,
  workflowBadgeVariant,
  workflowCardClass,
} from "./workflow-types";

const FILTER_KEYS = [
  "search",
  "module",
  "status",
  "featureKey",
  "shopDomain",
  "actorId",
  "from",
  "to",
] as const;
type Cursor = Record<string, string>;
export function WorkflowLogs({
  profile,
  actor,
  initialRunId,
  onBack,
}: {
  profile: PublicProfile;
  actor: Actor;
  initialRunId?: string;
  onBack?: () => void;
}) {
  const [filters, setFilters] = useState<LogFilterValues>({});
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialRunId ?? null);
  const [cursors, setCursors] = useState<Cursor[]>([{}]);
  const [page, setPage] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const target = { profileId: profile.id, revision: profile.revision };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFilters(
      Object.fromEntries(
        FILTER_KEYS.flatMap((key) =>
          params.get(key) ? [[key, params.get(key) as string]] : []
        )
      )
    );
    setSelected(initialRunId ?? params.get("run"));
    setReady(true);
  }, [initialRunId]);
  const updateUrl = (nextFilters: LogFilterValues, run: string | null) => {
    const url = new URL(window.location.href);
    for (const key of FILTER_KEYS) {
      const value = nextFilters[key];
      if (value) {
        url.searchParams.set(key, value);
      } else {
        url.searchParams.delete(key);
      }
    }
    if (run) {
      url.searchParams.set("run", run);
    } else {
      url.searchParams.delete("run");
    }
    window.history.replaceState(window.history.state, "", url);
  };
  const list = useQuery({
    enabled: ready,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        profileId: profile.id,
        resource: "logs",
        revision: String(profile.revision),
        ...filters,
        ...cursors[page],
      });
      const result = await request<{
        target: TargetRef;
        data: { rows: WorkflowRun[]; next: Cursor | null };
      }>(`diagnostics?${params}`, { signal });
      if (
        result.target.profileId !== profile.id ||
        result.target.revision !== profile.revision
      ) {
        throw new Error("The connection changed. Refresh this view.");
      }
      return result.data;
    },
    queryKey: queryKey(actor.id, target, "configured", "logs", {
      ...filters,
      ...cursors[page],
    }),
    refetchInterval: autoRefresh ? 10_000 : false,
  });
  const options = useQuery({
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        profileId: profile.id,
        resource: "log-options",
        revision: String(profile.revision),
      });
      const result = await request<{
        target: TargetRef;
        data: { modules: string[]; featureKeys: string[]; timeZone?: string };
      }>(`diagnostics?${params}`, { signal });
      if (
        result.target.profileId !== profile.id ||
        result.target.revision !== profile.revision
      ) {
        throw new Error("The connection changed. Refresh this view.");
      }
      return result.data;
    },
    queryKey: queryKey(actor.id, target, "configured", "log-options"),
  });
  const runs = list.data?.rows ?? [];
  const runId = selected ?? runs[0]?.id ?? null;
  return (
    <div className="space-y-4">
      {onBack ? (
        <Button onClick={onBack} size="sm" type="button" variant="outline">
          ← Overview
        </Button>
      ) : null}
      <Panel
        action={
          <div className="flex flex-wrap items-center gap-3">
            <CheckboxField
              checked={autoRefresh}
              id="workflow-auto-refresh"
              label="Auto refresh (10s)"
              onCheckedChange={(checked) => setAutoRefresh(checked === true)}
            />
            <Button
              disabled={list.isFetching}
              onClick={() => list.refetch()}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw className={list.isFetching ? "animate-spin" : ""} />
              Refresh runs
            </Button>
          </div>
        }
        title="Filters"
      >
        {ready ? (
          <LogFilters
            featureKeys={options.data?.featureKeys ?? []}
            initialValues={filters}
            modules={options.data?.modules ?? []}
            onSubmit={(next) => {
              setFilters(next);
              setCursors([{}]);
              setPage(0);
              setSelected(null);
              updateUrl(next, null);
            }}
          />
        ) : (
          <Skeleton className="h-20 w-full" />
        )}
      </Panel>
      <div className="grid items-start gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
        <section
          aria-label="Workflow runs"
          className="min-w-0 overflow-hidden rounded-xl border bg-card"
        >
          <header className="border-b px-4 py-3">
            <h2 className="font-semibold text-sm">Workflow Runs</h2>
            <p className="mt-1 text-muted-foreground text-xs">
              {runs.length} runs · Page {page + 1}
            </p>
          </header>
          {list.error ? (
            <div className="space-y-3 p-4">
              <ErrorNotice message={list.error.message} />
              <Button
                onClick={() => list.refetch()}
                size="sm"
                type="button"
                variant="outline"
              >
                Try again
              </Button>
            </div>
          ) : null}
          {list.isPending ? (
            <div className="space-y-3 p-4" role="status">
              <span className="sr-only">Loading {profile.name}…</span>
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : null}
          <div className="max-h-[820px] overflow-y-auto">
            {runs.map((run) => (
              <Button
                aria-label={`Open workflow ${run.title || run.id}`}
                aria-pressed={runId === run.id}
                className={`h-auto w-full flex-col items-stretch justify-start whitespace-normal rounded-none border-b border-l-4 px-4 py-3 text-left ${workflowCardClass(runId === run.id, run.errorCount)}`}
                key={run.id}
                onClick={() => {
                  setSelected(run.id);
                  updateUrl(filters, run.id);
                }}
                type="button"
                variant="ghost"
              >
                <div className="flex min-w-0 flex-col items-start gap-2">
                  <h3 className="line-clamp-2 break-words font-semibold text-sm">
                    {run.title || run.id}
                  </h3>
                  <Badge variant={workflowBadgeVariant(run.status)}>
                    {formatLogLabel(run.status ?? "UNKNOWN")}
                  </Badge>
                </div>
                <p className="mt-2 truncate text-muted-foreground text-xs">
                  {run.workflowKey || run.featureKey || run.module}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>{formatDuration(run.durationMs)}</span>
                  <span>{run.logCount ?? 0} logs</span>
                  <span className="text-muted-foreground">
                    {run.warningCount ?? 0} warnings
                  </span>
                  <span
                    className={
                      run.errorCount > 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {run.errorCount ?? 0} errors
                  </span>
                </div>
                <p className="mt-2 text-muted-foreground text-xs">
                  {formatLogDate(run.createdAt, false, options.data?.timeZone)}{" "}
                  · {run.actor?.email || "system"}
                </p>
              </Button>
            ))}
            {!(list.isPending || list.error) && runs.length === 0 ? (
              <p className="p-8 text-center text-muted-foreground text-sm">
                No workflow runs found. Try another filter.
              </p>
            ) : null}
          </div>
          <footer className="flex items-center justify-between border-t px-4 py-3">
            <Button
              disabled={page === 0 || list.isFetching}
              onClick={() => {
                setPage((current) => current - 1);
                setSelected(null);
                updateUrl(filters, null);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Previous
            </Button>
            <Button
              disabled={!list.data?.next || list.isFetching}
              onClick={() => {
                if (!list.data?.next) {
                  return;
                }
                setCursors((current) => [
                  ...current.slice(0, page + 1),
                  list.data.next as Cursor,
                ]);
                setPage((current) => current + 1);
                setSelected(null);
                updateUrl(filters, null);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Next
            </Button>
          </footer>
        </section>
        <WorkflowRunDetailPanel
          actor={actor}
          autoRefresh={autoRefresh}
          key={`${profile.id}:${profile.revision}:${runId}`}
          profile={profile}
          runId={runId}
          timeZone={options.data?.timeZone}
        />
      </div>
    </div>
  );
}
