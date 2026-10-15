"use client";

import { apiClient } from "@repo/api/client";
import {
  Activity,
  Archive,
  ArchiveRestore,
  Box,
  Braces,
  Building2,
  Button,
  CircleX,
  Database,
  Download,
  ErrorAlert,
  HardDriveDownload,
  KeyRound,
  type LucideIcon,
  MailX,
  PencilLine,
  Play,
  Power,
  PowerOff,
  Save,
  SegmentedControl,
  Send,
  Shield,
  SkeletonRows,
  Store,
  Tag,
  Trash2,
  Unplug,
  UserCheck,
  UserCog,
  Workflow,
} from "@repo/design-system";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatDateTime } from "../../lib/format";
import { ListFrame } from "../people";
import { AUDIT_FILTERS, type AuditFilter } from "./access-model";

type AuditPage = Awaited<ReturnType<typeof apiClient.organizations.auditLogs>>;
type AuditEvent = AuditPage["data"][number];

const PAGE_SIZE = 20;
const COLUMNS = "140px 28px minmax(0,1fr) 190px";

type Metadata = Record<string, unknown>;

const text = (metadata: Metadata, field: string) => {
  const value = metadata[field];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
};

/** "Tag orders #128 on evisu-hk.myshopify.com", from a run's metadata. */
const runObject = (metadata: Metadata) =>
  `${text(metadata, "flowName")} #${text(metadata, "runNumber")}${
    text(metadata, "shopDomain") ? ` on ${text(metadata, "shopDomain")}` : ""
  }`;

const activationObject = (metadata: Metadata) =>
  `${text(metadata, "flowName")} on ${text(metadata, "shopDomain")}${
    text(metadata, "status") === "FAILED" ? " (failed)" : ""
  }`;

/**
 * How an action reads: an icon, a verb phrase, and its object, named by a
 * metadata field or built from several.
 */
const EVENTS: Record<
  string,
  {
    icon: LucideIcon;
    object?: string | ((metadata: Metadata) => string);
    what: string;
  }
> = {
  "database.backup.deleted": {
    icon: Trash2,
    object: "connectionName",
    what: "deleted a backup of",
  },
  "database.backup.downloaded": {
    icon: Download,
    object: "connectionName",
    what: "downloaded a backup of",
  },
  "database.backup.started": {
    icon: HardDriveDownload,
    object: "connectionName",
    what: "started a backup of",
  },
  "database.connection.created": {
    icon: Database,
    object: "name",
    what: "added connection",
  },
  "database.connection.deleted": {
    icon: Trash2,
    object: "name",
    what: "deleted connection",
  },
  "database.connection.updated": {
    icon: Database,
    object: "name",
    what: "updated connection",
  },
  "flow.activated": {
    icon: Power,
    object: activationObject,
    what: "activated flow",
  },
  "flow.archived": { icon: Archive, object: "name", what: "archived flow" },
  "flow.created": { icon: Workflow, object: "name", what: "created flow" },
  "flow.deactivated": {
    icon: PowerOff,
    object: activationObject,
    what: "deactivated flow",
  },
  "flow.restored": {
    icon: ArchiveRestore,
    object: "name",
    what: "restored flow",
  },
  "flow.run.canceled": {
    icon: CircleX,
    object: runObject,
    what: "canceled run",
  },
  "flow.run.started": { icon: Play, object: runObject, what: "ran flow" },
  "flow.updated": { icon: PencilLine, object: "name", what: "edited flow" },
  "flow.version_saved": {
    icon: Save,
    object: (metadata) =>
      `${text(metadata, "name")} · v${text(metadata, "version")}`,
    what: "saved a version of",
  },
  "invitation.accepted": {
    icon: UserCheck,
    object: "email",
    what: "accepted the invitation for",
  },
  "invitation.created": { icon: Send, object: "email", what: "invited" },
  "invitation.revoked": { icon: MailX, what: "revoked an invitation" },
  "member.role_updated": {
    icon: UserCog,
    object: "roleName",
    what: "changed a member’s role to",
  },
  "organization.created": {
    icon: Building2,
    object: "name",
    what: "created the organization",
  },
  "role.created": { icon: Shield, object: "name", what: "created role" },
  "shopify.app.created": { icon: Box, object: "name", what: "added app" },
  "shopify.app.deleted": { icon: Trash2, object: "name", what: "removed app" },
  "shopify.app.updated": { icon: Box, object: "name", what: "updated app" },
  "shopify.graphql.mutation": {
    icon: Braces,
    object: "shopDomain",
    what: "ran a mutation on",
  },
  "shopify.graphql.query": {
    icon: Braces,
    object: "shopDomain",
    what: "ran a query on",
  },
  "shopify.store.connected": {
    icon: Store,
    object: "shopDomain",
    what: "connected store",
  },
  "shopify.store.disconnected": {
    icon: Unplug,
    object: "shopDomain",
    what: "disconnected store",
  },
  "shopify.store.environment_changed": {
    icon: Tag,
    object: "environment",
    what: "changed a store’s environment to",
  },
  "shopify.store.oauth_started": {
    icon: KeyRound,
    object: "shopDomain",
    what: "started OAuth for",
  },
};

const objectText = (
  metadata: unknown,
  object: string | ((metadata: Metadata) => string) | undefined
) => {
  if (!(object && metadata && typeof metadata === "object")) {
    return "";
  }
  return typeof object === "string"
    ? text(metadata as Metadata, object)
    : object(metadata as Metadata);
};

/** "Oct 14 16:00", in the viewer's time zone. */
const auditTime = (value: Date | string) => {
  const date = new Date(value);
  const day = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  });
  return `${day} ${time}`;
};

const AuditRow = ({ event }: { event: AuditEvent }) => {
  const known = EVENTS[event.action];
  const Icon = known?.icon ?? Activity;
  const object = objectText(event.metadata, known?.object);
  return (
    <div
      className="grid items-center gap-3 border-border border-b px-4 py-2.5 last:border-b-0"
      style={{ gridTemplateColumns: COLUMNS }}
    >
      <time
        className="font-mono text-muted-foreground text-xs leading-[1.3]"
        dateTime={new Date(event.createdAt).toISOString()}
        title={formatDateTime(event.createdAt)}
      >
        {auditTime(event.createdAt)}
      </time>
      <span className="grid size-[26px] place-items-center rounded-[7px] border border-border bg-sunken text-foreground-2">
        <Icon className="size-[13px]" />
      </span>
      <span className="min-w-0 text-[13px] leading-[1.4]">
        <strong className="font-semibold">
          {event.actor?.name ?? "System"}
        </strong>{" "}
        {known?.what ?? "recorded"}{" "}
        {object ? (
          <span className="break-all font-mono text-foreground-2 text-xs">
            {object}
          </span>
        ) : null}
      </span>
      <span className="truncate text-right font-mono text-[11.5px] text-faint leading-none">
        {event.action}
      </span>
    </div>
  );
};

/** The organization's audit trail with a filter by area. */
export function AuditLog({ organizationId }: { organizationId: string }) {
  const [filter, setFilter] = useState<AuditFilter>("all");
  const prefixes =
    AUDIT_FILTERS.find((item) => item.value === filter)?.prefixes ?? "";
  const events = useInfiniteQuery({
    getNextPageParam: (lastPage: AuditPage) =>
      lastPage.pageInfo.nextCursor ?? undefined,
    // An empty cursor means the first page.
    initialPageParam: "",
    queryFn: ({ pageParam }): Promise<AuditPage> =>
      apiClient.organizations.auditLogs({
        limit: PAGE_SIZE,
        organizationId,
        ...(prefixes ? { actionPrefix: prefixes } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    queryKey: ["audit-log", organizationId, filter],
  });
  const list = events.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="flex-1 font-semibold text-[15px] leading-[1.3]">
          Audit log
        </h2>
        <SegmentedControl
          aria-label="Audit log filter"
          onValueChange={setFilter}
          options={AUDIT_FILTERS.map((item) => ({
            label: item.label,
            value: item.value,
          }))}
          value={filter}
        />
      </div>
      {events.isError ? (
        <ErrorAlert
          message="Events are still being recorded."
          onRetry={() => events.refetch()}
          title="Couldn't load the audit log."
        />
      ) : (
        <ListFrame minWidth={680}>
          {events.isPending ? (
            <SkeletonRows columns={COLUMNS} count={5} rowHeight={47} />
          ) : null}
          {events.isSuccess && list.length === 0 ? (
            <p className="px-4 py-5 text-center text-[13px] text-muted-foreground">
              No events match this filter.
            </p>
          ) : null}
          {list.map((event) => (
            <AuditRow event={event} key={event.id} />
          ))}
          {events.hasNextPage ? (
            <Button
              className="h-10 w-full rounded-none font-medium text-[12.5px] text-muted-foreground"
              disabled={events.isFetchingNextPage}
              onClick={() => events.fetchNextPage()}
              variant="ghost"
            >
              {events.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </ListFrame>
      )}
    </section>
  );
}
