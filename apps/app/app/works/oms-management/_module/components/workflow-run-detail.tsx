"use client";

import {
  Button,
  Copy,
  cn,
  Download,
  RefreshCw,
  SegmentedControl,
  StatusBadge,
} from "@repo/design-system";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Actor, PublicProfile, TargetRef } from "../lib/contracts";
import { queryKey } from "../lib/contracts";
import { request } from "./management-app";
import { ErrorNotice } from "./oms-ui";
import { useWorkflowActions } from "./workflow-actions";
import {
  formatDuration,
  formatLogDate,
  formatLogLabel,
  type WorkflowDetail,
  type WorkflowLog,
  type WorkflowRun,
} from "./workflow-types";

const json = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
export function WorkflowRunDetailPanel({
  profile,
  actor,
  runId,
  autoRefresh,
  timeZone,
}: {
  profile: PublicProfile;
  actor: Actor;
  runId: string | null;
  autoRefresh: boolean;
  timeZone?: string | undefined;
}) {
  const target = { profileId: profile.id, revision: profile.revision };
  const { action, notice, error, perform } = useWorkflowActions(target, runId);
  const query = useInfiniteQuery({
    enabled: Boolean(runId),
    getNextPageParam: (last: WorkflowDetail) => last.nextSequence ?? undefined,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        after: String(pageParam),
        id: runId ?? "",
        profileId: profile.id,
        resource: "log",
        revision: String(profile.revision),
      });
      const result = await request<{ target: TargetRef; data: WorkflowDetail }>(
        `diagnostics?${params}`,
        { signal }
      );
      if (
        result.target.profileId !== profile.id ||
        result.target.revision !== profile.revision
      ) {
        throw new Error("The connection changed. Refresh this view.");
      }
      return result.data;
    },
    queryKey: queryKey(actor.id, target, "configured", "log", { id: runId }),
    refetchInterval: autoRefresh ? 10_000 : false,
  });
  const [level, setLevel] = useState<"ALL" | "ERROR" | "WARN">("ALL");
  const run = query.data?.pages[0]?.run;
  const logs = query.data?.pages.flatMap((page) => page.logs) ?? [];
  if (!runId) {
    return (
      <div className={cn(PANE, "place-content-center p-8 text-center")}>
        <h2 className="font-semibold text-[15px]">Select a workflow run</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Run timeline and error payloads will appear here.
        </p>
      </div>
    );
  }
  if (query.isPending) {
    return (
      <div className={cn(PANE, "content-start gap-3 p-6")} role="status">
        <span className="sr-only">Loading workflow details…</span>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (query.error && !run) {
    return (
      <div className={cn(PANE, "content-start justify-items-start gap-3 p-6")}>
        <ErrorNotice message={query.error.message} />
        <Button onClick={() => query.refetch()} type="button" variant="outline">
          Retry details
        </Button>
      </div>
    );
  }
  if (!run) {
    return null;
  }
  const visibleLogs =
    level === "ALL" ? logs : logs.filter((log) => log.level === level);
  const countOf = (name: string) =>
    logs.filter((log) => log.level === name).length;
  return (
    <section
      aria-label="Workflow detail"
      className="flex min-w-0 flex-[999_1_520px] flex-col"
    >
      <header className="flex flex-wrap items-start gap-3 border-border border-b px-6 pt-4 pb-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words font-semibold text-[15px] leading-[22px] tracking-[-0.01em]">
              {run.title || run.id}
            </h2>
            <StatusBadge status={run.status.toUpperCase()}>
              {formatLogLabel(run.status)}
            </StatusBadge>
          </div>
          <p className="break-all text-muted-foreground text-xs tabular-nums">
            run {run.id}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.module === "IMPORT_EXPORT" &&
          run.targetType === "ImportBatch" ? (
            <Button
              disabled={action !== null}
              onClick={() => perform("download")}
              size="sm"
              type="button"
              variant="outline"
            >
              <Download />
              {action === "download" ? "Downloading…" : "Download Original"}
            </Button>
          ) : null}
          <Button
            disabled={action !== null}
            onClick={() => perform("copy")}
            size="sm"
            type="button"
            variant="outline"
          >
            <Copy />
            {action === "copy" ? "Copying…" : "Copy Bundle"}
          </Button>
          <Button
            aria-label="Refresh workflow details"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw className={query.isFetching ? "animate-spin" : ""} />
          </Button>
        </div>
      </header>
      <div className="flex min-w-0 flex-col gap-5 px-6 py-5">
        <RunMetrics logs={logs} run={run} timeZone={timeZone} />
        <ActionNotice error={error} notice={notice} queryError={query.error} />
        <div className="grid min-w-0 items-start gap-4 2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className={LABEL}>Run context</h3>
            <pre className="max-h-[560px] overflow-auto rounded-[10px] bg-sunken px-3.5 py-3 font-mono text-[12px] text-foreground-2 leading-5 shadow-[inset_0_0_0_1px_var(--border)]">
              {json(run.summary)}
            </pre>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-h-[30px] flex-wrap items-center gap-2">
              <h3 className={cn(LABEL, "flex-1")}>
                Logs{" "}
                <span className="normal-case tracking-normal">
                  · {logs.length} loaded
                </span>
              </h3>
              <SegmentedControl
                aria-label="Log level"
                onValueChange={setLevel}
                options={[
                  { count: logs.length, label: "All", value: "ALL" },
                  { count: countOf("ERROR"), label: "Errors", value: "ERROR" },
                  { count: countOf("WARN"), label: "Warn", value: "WARN" },
                ]}
                value={level}
              />
            </div>
            <div className="max-h-[760px] overflow-y-auto rounded-card bg-sunken py-1.5 shadow-[inset_0_0_0_1px_var(--border)]">
              {visibleLogs.map((log) => (
                <TimelineLog key={log.id} log={log} timeZone={timeZone} />
              ))}
              {visibleLogs.length ? null : (
                <p className="py-8 text-center text-[13px] text-muted-foreground">
                  No log entries recorded.
                </p>
              )}
            </div>
            {query.hasNextPage ? (
              <Button
                className="self-start"
                disabled={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
                size="sm"
                type="button"
                variant="outline"
              >
                {query.isFetchingNextPage
                  ? "Loading…"
                  : "Load more log entries"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

const PANE = "grid min-h-96 min-w-0 flex-[999_1_520px]";
const LABEL = "font-medium text-[11px] text-faint uppercase tracking-[0.06em]";

const LEVEL_SURFACES: Record<string, string> = {
  ERROR: "bg-prod-soft",
  WARN: "bg-(--alert-warning-bg)",
};
const LEVEL_TEXT: Record<string, string> = {
  ERROR: "text-(--status-danger-fg)",
  WARN: "text-(--status-warning-fg)",
};

const METRIC_TONES = {
  danger: "text-(--status-danger-fg)",
  warning: "text-(--status-warning-fg)",
} as const;

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null | undefined;
  tone?: keyof typeof METRIC_TONES | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-card px-3.5 py-2.5">
      <dt className={LABEL}>{label}</dt>
      <dd
        className={cn(
          "break-words text-[13px] tabular-nums",
          tone && METRIC_TONES[tone]
        )}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
function TimelineLog({
  log,
  timeZone,
}: {
  log: WorkflowLog;
  timeZone?: string | undefined;
}) {
  const hasDetails = Boolean(log.errorDetails || log.metadata);
  return (
    <article className={cn("px-3 py-1", LEVEL_SURFACES[log.level])}>
      <div className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11.5px] leading-[22px] tracking-[-0.01em]">
        <time
          className="text-faint"
          dateTime={log.createdAt}
          title={formatLogDate(log.createdAt, false, timeZone)}
        >
          {formatLogDate(log.createdAt, true, timeZone)}
        </time>
        <span
          className={cn(
            "w-10",
            log.level === "ERROR" && "font-semibold",
            LEVEL_TEXT[log.level] ?? "text-muted-foreground"
          )}
        >
          {log.level}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          {log.message}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-2.5 text-muted-foreground text-xs">
        <span className="font-medium text-foreground-2">{log.stage}</span>
        <span>#{log.sequence}</span>
        {log.event ? <span>{log.event}</span> : null}
        {log.status ? <span>{log.status}</span> : null}
        {log.rowNumber !== null && log.rowNumber !== undefined ? (
          <span>Row {log.rowNumber}</span>
        ) : null}
        {log.shopDomain ? <span>{log.shopDomain}</span> : null}
        {log.operationName ? <span>{log.operationName}</span> : null}
        {log.durationMs !== null && log.durationMs !== undefined ? (
          <span>{formatDuration(log.durationMs)}</span>
        ) : null}
        {log.errorName ? <span>{log.errorName}</span> : null}
        {log.errorCode ? <span>{log.errorCode}</span> : null}
      </div>
      {log.targetId ? (
        <p className="break-all text-muted-foreground text-xs">
          {[log.targetType, log.targetId].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {log.errorMessage ? (
        <p className="whitespace-pre-wrap break-words text-prod-ink text-xs">
          {log.errorMessage}
        </p>
      ) : null}
      {hasDetails ? (
        <details className="py-1">
          <summary className="cursor-pointer font-medium text-xs">
            Payload
          </summary>
          <pre className="mt-1.5 max-h-72 overflow-auto rounded-[10px] bg-card p-3 font-mono text-[12px] text-foreground-2 leading-5 shadow-[inset_0_0_0_1px_var(--border)]">
            {json({ errorDetails: log.errorDetails, metadata: log.metadata })}
          </pre>
        </details>
      ) : null}
    </article>
  );
}

function RunMetrics({
  run,
  logs,
  timeZone,
}: {
  run: WorkflowRun;
  logs: WorkflowLog[];
  timeZone?: string | undefined;
}) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card bg-border shadow-[0_0_0_1px_var(--border)] md:grid-cols-3 xl:grid-cols-5">
      <Metric label="Feature" value={run.featureKey} />
      <Metric label="Workflow" value={run.workflowKey} />
      <Metric
        label="Target"
        value={[run.targetType, run.targetId].filter(Boolean).join(" · ")}
      />
      <Metric
        label="Actor"
        value={
          run.actor
            ? [run.actor.name, run.actor.email].filter(Boolean).join(" · ")
            : "system"
        }
      />
      <Metric label="Module" value={formatLogLabel(run.module)} />
      <Metric
        label="Started"
        value={formatLogDate(run.startedAt ?? run.createdAt, false, timeZone)}
      />
      <Metric
        label="Completed"
        value={formatLogDate(run.completedAt, false, timeZone)}
      />
      <Metric label="Duration" value={formatDuration(run.durationMs)} />
      <Metric
        label="Warnings"
        tone={(run.warningCount ?? 0) > 0 ? "warning" : undefined}
        value={String(
          run.warningCount ?? logs.filter((log) => log.level === "WARN").length
        )}
      />
      <Metric
        label="Errors"
        tone={(run.errorCount ?? 0) > 0 ? "danger" : undefined}
        value={String(
          run.errorCount ?? logs.filter((log) => log.level === "ERROR").length
        )}
      />
    </dl>
  );
}

function ActionNotice({
  notice,
  error,
  queryError,
}: {
  notice: string;
  error: string;
  queryError: Error | null;
}) {
  const failure = error || queryError?.message;
  return (
    <>
      {notice ? (
        <p className="text-[13px]" role="status">
          {notice}
        </p>
      ) : null}
      {failure ? <ErrorNotice message={failure} /> : null}
    </>
  );
}
