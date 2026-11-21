"use client";

import {
  Button,
  ErrorAlert,
  InlineAlert,
  Square,
  StatusBadge,
} from "@repo/design-system";
import { useEffect, useRef } from "react";
import { formatDateTime } from "../../lib/format";
import type { FunctionRunState } from "./use-function-run";

/** "850 ms", "12.4 s" or "3 m 05 s". */
export const formatRunDuration = (ms: number | null) => {
  if (ms === null) {
    return "—";
  }
  if (ms < 1000) {
    return `${ms} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} m ${String(seconds % 60).padStart(2, "0")} s`;
};

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-[11px] text-muted-foreground">{label}</dt>
    <dd className="truncate font-medium text-[12.5px] tabular-nums">{value}</dd>
  </div>
);

/** The followed run's output, result and facts; all shown as plain text. */
export function OutputTab({
  canRun,
  state,
}: {
  canRun: boolean;
  state: FunctionRunState;
}) {
  const { output, run } = state;
  const outputRef = useRef<HTMLPreElement>(null);

  // Stay at the bottom while new output arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when output grows
  useEffect(() => {
    const element = outputRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [output]);

  if (!run) {
    return (
      <p className="p-4 text-[13px] text-muted-foreground">
        {state.runId
          ? "Loading the run…"
          : "Run the function to see its output here."}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[13px]">Run #{run.number}</span>
          <StatusBadge status={run.status} />
        </div>
        {canRun && state.isActive ? (
          <Button
            disabled={state.isCanceling || run.cancelRequestedAt !== null}
            onClick={state.cancel}
            size="sm"
            type="button"
            variant="outline"
          >
            <Square className="size-3" />
            {run.cancelRequestedAt ? "Stopping…" : "Cancel"}
          </Button>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <Fact label="Duration" value={formatRunDuration(run.durationMs)} />
        <Fact
          label="Exit code"
          value={run.exitCode === null ? "—" : String(run.exitCode)}
        />
        <Fact label="Started" value={formatDateTime(run.createdAt)} />
        {run.dbCallCount > 0 || run.shopifyCallCount > 0 ? (
          <>
            <Fact label="Database calls" value={String(run.dbCallCount)} />
            <Fact label="Shopify calls" value={String(run.shopifyCallCount)} />
          </>
        ) : null}
      </dl>
      {state.error ? <ErrorAlert message={state.error} /> : null}
      {run.error ? (
        <InlineAlert title="Error" tone="danger">
          <span className="whitespace-pre-wrap font-mono text-xs">
            {run.error}
          </span>
        </InlineAlert>
      ) : null}
      <section className="flex min-h-[160px] flex-1 flex-col gap-1.5">
        <h3 className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
          Output
        </h3>
        <pre
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-menu border border-border bg-sunken p-3 font-mono text-xs leading-relaxed"
          data-testid="run-output"
          ref={outputRef}
        >
          {output || (state.isActive ? "Waiting for output…" : "No output.")}
        </pre>
        {run.outputTruncated ? (
          <p className="text-[12px] text-muted-foreground">
            The output was cut off at the size limit; the rest was not kept.
          </p>
        ) : null}
      </section>
      {run.result === undefined || run.result === null ? null : (
        <section className="flex flex-col gap-1.5">
          <h3 className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
            Return value
          </h3>
          <pre
            className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-menu border border-border bg-sunken p-3 font-mono text-xs"
            data-testid="run-result"
          >
            {JSON.stringify(run.result, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
