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
import { type ReactNode, useState } from "react";
import type { Actor, PublicProfile } from "../lib/contracts";
import { queryKey } from "../lib/contracts";
import { request } from "./management-app";
import { ErrorNotice, Panel } from "./oms-ui";
import { WorkflowLogs } from "./workflow-logs";

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
  const failures = ((data.failures as RecordValue)?.rows ??
    []) as RecordValue[];
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <Metric
          badge={<StatusBadge tone="success">Reachable</StatusBadge>}
          detail="Connection verified"
          label="Database"
          value="Connected"
        />
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
          detail={`Refreshed ${new Date(String(data.refreshedAt)).toLocaleString()}`}
          label="Available views"
          value={String(compatibility.features.length)}
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          action={
            <span className="inline-flex h-5 items-center rounded-[5px] bg-hover px-1.5 text-[11px] text-foreground-2 tabular-nums">
              {failures.length}
            </span>
          }
          bodyClassName="px-0"
          title="Recent failed workflows"
        >
          <DataTable
            onRow={(row) => setDetail(String(row.id))}
            rows={failures}
          />
        </Panel>
        <Panel
          action={
            <span className="text-faint text-xs tabular-nums">
              {compatibility.features.length}
            </span>
          }
          bodyClassName="px-2"
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
    </>
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

function DataTable({
  rows,
  onRow,
}: {
  rows: RecordValue[];
  onRow?: ((row: RecordValue) => void) | undefined;
}) {
  const firstRow = rows.at(0);
  if (!firstRow) {
    return (
      <div className="px-4 py-10 text-center">
        <h3 className="font-semibold text-[13px]">No records to display</h3>
        <p className="mt-1 text-muted-foreground text-xs">
          Try another filter or refresh this view.
        </p>
      </div>
    );
  }
  const columns = Object.keys(firstRow).filter(
    (key) => !["accountId", "actorId", "summary"].includes(key)
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((key) => (
            <TableHead key={key}>{key.replace(/([A-Z])/g, " $1")}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={String(row.id ?? row.jobKey ?? index)}>
            {columns.map((key, column) => (
              <TableCell
                className="max-w-80 whitespace-normal break-words"
                key={key}
              >
                <DataCell
                  isFirst={column === 0}
                  keyName={key}
                  onRow={onRow}
                  row={row}
                />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DataCell({
  row,
  keyName,
  isFirst,
  onRow,
}: {
  row: RecordValue;
  keyName: string;
  isFirst: boolean;
  onRow?: ((row: RecordValue) => void) | undefined;
}) {
  const value = row[keyName];
  if (isFirst && onRow) {
    return (
      <Button
        className="h-auto justify-start whitespace-normal p-0 text-left text-xs tabular-nums"
        onClick={() => onRow(row)}
        type="button"
        variant="link"
      >
        {String(value ?? "—")}
      </Button>
    );
  }
  if (keyName === "status") {
    return (
      <StatusBadge status={String(value).toUpperCase()}>
        {String(value)}
      </StatusBadge>
    );
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "—");
}
