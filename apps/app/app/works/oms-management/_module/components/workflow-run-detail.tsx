"use client";

import {
  Button,
  Copy,
  Download,
  RefreshCw,
  StatusBadge,
} from "@repo/design-system";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
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
  const run = query.data?.pages[0]?.run;
  const logs = query.data?.pages.flatMap((page) => page.logs) ?? [];
  if (!runId) {
    return (
      <div className="min-h-96 rounded-xl border bg-card p-8 text-center">
        <h2 className="font-semibold text-sm">Select a workflow run</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Run timeline and error payloads will appear here.
        </p>
      </div>
    );
  }
  if (query.isPending) {
    return (
      <div className="space-y-3 rounded-xl border p-5" role="status">
        <span className="sr-only">Loading workflow details…</span>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (query.error && !run) {
    return (
      <div className="space-y-3 rounded-xl border p-5">
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
  return (
    <section
      aria-label="Workflow detail"
      className="min-w-0 overflow-hidden rounded-card bg-card shadow-card"
    >
      <header className="border-border border-b px-6 pt-4 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
              {run.module}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="break-words font-semibold text-[15px] leading-[22px] tracking-[-0.01em]">
                {run.title || run.id}
              </h2>
              <StatusBadge status={run.status.toUpperCase()}>
                {formatLogLabel(run.status)}
              </StatusBadge>
            </div>
            <p className="mt-1 break-all text-muted-foreground text-xs tabular-nums">
              {run.id}
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
              size="sm"
              type="button"
              variant="ghost"
            >
              <RefreshCw className={query.isFetching ? "animate-spin" : ""} />
            </Button>
          </div>
        </div>
        <RunMetrics logs={logs} run={run} />
        <ActionNotice error={error} notice={notice} queryError={query.error} />
      </header>
      <div className="grid min-w-0 2xl:grid-cols-[minmax(0,1fr)_270px]">
        <div className="min-w-0 px-6 py-5">
          <h3 className="mb-3 font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
            Timeline{" "}
            <span className="normal-case tracking-normal">
              · {logs.length} loaded
            </span>
          </h3>
          <div className="max-h-[760px] space-y-3 overflow-y-auto pr-1">
            {logs.map((log) => (
              <TimelineLog key={log.id} log={log} timeZone={timeZone} />
            ))}
            {logs.length ? null : (
              <p className="py-8 text-center text-muted-foreground text-sm">
                No log entries recorded.
              </p>
            )}
          </div>
          {query.hasNextPage ? (
            <Button
              className="mt-4"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
              type="button"
              variant="outline"
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more log entries"}
            </Button>
          ) : null}
        </div>
        <RunContext run={run} timeZone={timeZone} />
      </div>
    </section>
  );
}
const LEVEL_DOTS: Record<string, string> = {
  ERROR: "bg-(--status-danger-dot)",
  WARN: "bg-(--status-warning-dot)",
};
const LEVEL_SURFACES: Record<string, string> = {
  ERROR: "bg-prod-soft",
  WARN: "bg-(--alert-warning-bg)",
};
const LEVEL_TEXT: Record<string, string> = {
  ERROR: "text-(--status-danger-fg)",
  WARN: "text-(--status-warning-fg)",
};

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-card px-3.5 py-2.5">
      <p className="font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
        {label}
      </p>
      <p
        className={`break-words text-[13px] tabular-nums ${danger ? "text-(--status-danger-fg)" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
        {label}
      </dt>
      <dd className="mt-1 break-all text-[12.5px] tabular-nums">
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
    <article className="relative border-border border-l-2 pl-4">
      <span
        className={`absolute top-3 -left-[5px] size-2 rounded-full ${LEVEL_DOTS[log.level] ?? "bg-ghost"}`}
      />
      <div
        className={`rounded-[10px] p-3 shadow-[inset_0_0_0_1px_var(--border)] ${LEVEL_SURFACES[log.level] ?? "bg-card"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`font-mono font-semibold text-[11px] ${LEVEL_TEXT[log.level] ?? "text-muted-foreground"}`}
          >
            {log.level}
          </span>
          <span className="font-semibold text-xs">{log.stage}</span>
          <span className="text-muted-foreground text-xs">#{log.sequence}</span>
          <time
            className="ml-auto text-muted-foreground text-xs"
            dateTime={log.createdAt}
            title={formatLogDate(log.createdAt, false, timeZone)}
          >
            {formatLogDate(log.createdAt, true, timeZone)}
          </time>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">
          {log.message}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-muted-foreground text-xs">
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
          <p className="mt-2 break-all text-muted-foreground text-xs">
            {[log.targetType, log.targetId].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {log.errorMessage ? (
          <p className="mt-2 whitespace-pre-wrap break-words text-destructive text-xs">
            {log.errorMessage}
          </p>
        ) : null}
        {hasDetails ? (
          <details className="mt-3">
            <summary className="cursor-pointer font-medium text-xs">
              Payload
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-[10px] bg-card p-3 font-mono text-[12px] text-foreground-2 leading-5 shadow-[inset_0_0_0_1px_var(--border)]">
              {json({ errorDetails: log.errorDetails, metadata: log.metadata })}
            </pre>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function RunMetrics({ run, logs }: { run: WorkflowRun; logs: WorkflowLog[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-card bg-border shadow-[0_0_0_1px_var(--border)] lg:grid-cols-4">
      <Metric label="Status" value={run.status} />
      <Metric label="Logs" value={String(run.logCount ?? logs.length)} />
      <Metric
        label="Warnings"
        value={String(
          run.warningCount ?? logs.filter((log) => log.level === "WARN").length
        )}
      />
      <Metric
        danger={(run.errorCount ?? 0) > 0}
        label="Errors"
        value={String(
          run.errorCount ?? logs.filter((log) => log.level === "ERROR").length
        )}
      />
    </div>
  );
}

function RunContext({
  run,
  timeZone,
}: {
  run: WorkflowRun;
  timeZone?: string | undefined;
}) {
  return (
    <aside className="min-w-0 border-border border-t bg-sunken p-4 2xl:border-t-0 2xl:border-l">
      <h3 className="font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
        Run context
      </h3>
      <dl className="mt-3 space-y-3 text-xs">
        <ContextRow label="Feature" value={run.featureKey} />
        <ContextRow label="Workflow" value={run.workflowKey} />
        <ContextRow
          label="Target"
          value={[run.targetType, run.targetId].filter(Boolean).join(" · ")}
        />
        <ContextRow
          label="Actor"
          value={
            run.actor
              ? [run.actor.name, run.actor.email].filter(Boolean).join(" · ")
              : "system"
          }
        />
        <ContextRow
          label="Started"
          value={formatLogDate(run.startedAt ?? run.createdAt, false, timeZone)}
        />
        <ContextRow
          label="Completed"
          value={formatLogDate(run.completedAt, false, timeZone)}
        />
        <ContextRow label="Duration" value={formatDuration(run.durationMs)} />
      </dl>
      <h3 className="mt-6 font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
        Summary
      </h3>
      <pre className="mt-3 max-h-80 overflow-auto rounded-[10px] bg-card p-3 font-mono text-[12px] text-foreground-2 leading-5 shadow-[inset_0_0_0_1px_var(--border)]">
        {json(run.summary)}
      </pre>
    </aside>
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
        <p className="mt-3 text-sm" role="status">
          {notice}
        </p>
      ) : null}
      {failure ? (
        <div className="mt-3">
          <ErrorNotice message={failure} />
        </div>
      ) : null}
    </>
  );
}
