"use client";
import { Button, Check, StatusBadge } from "@repo/design-system";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import type { Actor, PublicProfile } from "../lib/contracts";
import { queryKey } from "../lib/contracts";
import { managementHref } from "../lib/navigation";
import { request } from "./management-app";
import { ErrorNotice, Panel } from "./oms-ui";
import { WorkflowLogs } from "./workflow-logs";
import {
  formatLogDate,
  formatLogLabel,
  type WorkflowRun,
} from "./workflow-types";

type RecordValue = Record<string, unknown>;

export function Diagnostics(props: {
  profile: PublicProfile;
  actor: Actor;
  section: string;
}) {
  if (props.section === "logs") {
    return <WorkflowLogs actor={props.actor} profile={props.profile} />;
  }
  return <GeneralDiagnostics {...props} />;
}

function GeneralDiagnostics({
  profile,
  actor,
}: {
  profile: PublicProfile;
  actor: Actor;
}) {
  const [detail, setDetail] = useState<string | null>(null);
  const ref = { profileId: profile.id, revision: profile.revision };
  const query = useQuery({
    enabled: !detail,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        profileId: ref.profileId,
        resource: "overview",
        revision: String(ref.revision),
      });
      return request<{ target: typeof ref; data: RecordValue }>(
        `diagnostics?${params}`,
        { signal }
      );
    },
    queryKey: queryKey(actor.id, ref, "configured", "overview"),
  });
  if (detail) {
    return (
      <WorkflowLogs
        actor={actor}
        initialRunId={detail}
        onBack={() => setDetail(null)}
        profile={profile}
      />
    );
  }
  const data =
    query.data?.target.profileId === ref.profileId &&
    query.data?.target.revision === ref.revision
      ? query.data.data
      : undefined;
  if (query.isPending) {
    return (
      <div className="space-y-3" role="status">
        <span className="sr-only">Loading {profile.name}…</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    );
  }
  if (query.error) {
    return (
      <Panel title="Unable to load this view">
        <div className="flex flex-col items-start gap-3">
          <ErrorNotice message={query.error.message} />
          <Button
            onClick={() => query.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      </Panel>
    );
  }
  if (!data) {
    return null;
  }
  const compatibility = data.compatibility as { features: string[] };
  const failures = ((data.failures as RecordValue)?.rows ?? []) as FailedRun[];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric
          badge={
            data.api === "not-configured" ? (
              <StatusBadge tone="neutral">Off</StatusBadge>
            ) : (
              <StatusBadge tone="warning">Unverified</StatusBadge>
            )
          }
          detail="Commands require verified binding"
          label="OMS API"
          value={
            data.api === "not-configured" ? "Not configured" : "Not verified"
          }
        />
        <Metric
          badge={<StatusBadge tone="success">Reachable</StatusBadge>}
          detail="Connection verified"
          label="Database"
          value="Connected"
        />
        <Metric
          detail={`Refreshed ${new Date(String(data.refreshedAt)).toLocaleString()}`}
          label="Available views"
          value={String(compatibility.features.length)}
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          action={
            <Link
              className="text-[12.5px] text-accent-ink hover:text-accent"
              href={`${managementHref("logs", profile.id)}&status=FAILED`}
            >
              Open in Debug logs
            </Link>
          }
          bodyClassName="px-0"
          className="gap-0 pb-0"
          title={
            <span className="flex items-center gap-2.5">
              Recent failed workflows
              <span className="inline-flex h-5 items-center rounded-[5px] bg-hover px-1.5 font-normal text-[11px] text-foreground-2 tabular-nums">
                {failures.length}
              </span>
            </span>
          }
        >
          <FailedRunsTable onOpen={setDetail} rows={failures} />
        </Panel>
        <Panel
          action={
            <span className="text-faint text-xs tabular-nums">
              {compatibility.features.length}
            </span>
          }
          bodyClassName="px-2"
          className="gap-2 pb-2"
          title="Available views"
        >
          <ul className="flex flex-col gap-0.5">
            {compatibility.features.map((feature) => (
              <li
                className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]"
                key={feature}
              >
                <Check className="size-3.5 shrink-0 text-(--status-success-dot)" />
                <span className="truncate">{feature}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Metric({
  badge,
  label,
  value,
  detail,
}: {
  badge?: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-card bg-card p-4 shadow-card">
      <div className="flex min-h-[22px] items-center gap-2">
        <p className="flex-1 font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
          {label}
        </p>
        {badge}
      </div>
      <p className="font-semibold text-[26px] text-foreground leading-none tracking-[-0.02em]">
        {value}
      </p>
      <p className="truncate text-muted-foreground text-xs tabular-nums">
        {detail}
      </p>
    </div>
  );
}

type FailedRun = WorkflowRun & {
  logs?: { errorMessage: string | null; message: string }[];
};

/** The last thing a failed run logged: its error, else its final message. */
const failureReason = (run: FailedRun) => {
  const last = run.logs?.at(-1);
  return last?.errorMessage || last?.message || "—";
};

function FailedRunsTable({
  rows,
  onOpen,
}: {
  rows: FailedRun[];
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
        No failed workflows. Recent failures will appear here.
      </p>
    );
  }
  return (
    <Table
      className="table-fixed"
      containerClassName="rounded-none shadow-none"
    >
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Run</TableHead>
          <TableHead className="w-[30%]">Workflow</TableHead>
          <TableHead className="w-28">Module</TableHead>
          <TableHead>Error</TableHead>
          <TableHead className="w-40 text-right">When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((run) => (
          <TableRow key={run.id}>
            <TableCell>
              <Button
                aria-label={`Open run ${run.id}`}
                className="h-auto p-0 text-xs tabular-nums"
                onClick={() => onOpen(run.id)}
                title={run.id}
                type="button"
                variant="link"
              >
                {run.id.length > 12
                  ? `${run.id.slice(0, 4)}…${run.id.slice(-3)}`
                  : run.id}
              </Button>
            </TableCell>
            <TableCell>
              <span className="block truncate font-[550]" title={run.title}>
                {run.title || run.workflowKey}
              </span>
              <span className="block truncate text-muted-foreground text-xs">
                {run.workflowKey || run.featureKey}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {formatLogLabel(run.module)}
            </TableCell>
            <TableCell>
              <span
                className="block truncate text-(--status-danger-fg)"
                title={failureReason(run)}
              >
                {failureReason(run)}
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap text-right text-muted-foreground text-xs tabular-nums">
              {formatLogDate(run.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
