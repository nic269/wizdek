"use client";
import { Button } from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
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
import { useState } from "react";
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
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <Metric
          detail="Connection verified"
          label="Database"
          value="Connected"
        />
        <Metric
          detail="Commands require verified binding"
          label="OMS API"
          value={
            data.api === "not-configured" ? "Not configured" : "Not verified"
          }
        />
        <Metric
          detail={compatibility.features.join(" · ")}
          label="Available views"
          value={String(compatibility.features.length)}
        />
      </div>
      <Panel
        action={
          <span className="text-muted-foreground text-xs">
            {new Date(String(data.refreshedAt)).toLocaleString()}
          </span>
        }
        title="Recent failed workflows"
      >
        <DataTable
          onRow={(row) => setDetail(String(row.id))}
          rows={((data.failures as RecordValue)?.rows ?? []) as RecordValue[]}
        />
      </Panel>
    </>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Panel>
      <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-2 font-semibold text-2xl text-foreground">{value}</p>
      <p className="mt-1 text-muted-foreground text-xs">{detail}</p>
    </Panel>
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
      <div className="rounded-card border border-dashed py-10 text-center">
        <h3 className="font-medium text-sm">No records to display</h3>
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
        className="h-auto justify-start whitespace-normal p-0 text-left font-mono text-xs"
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
      <Badge
        variant={
          String(value).toLowerCase() === "failed" ? "destructive" : "outline"
        }
      >
        {String(value)}
      </Badge>
    );
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "—");
}
