"use client";

import { apiClient } from "@repo/api/client";
import { Button, ChevronDown, cn } from "@repo/design-system";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/design-system/components/ui/popover";
import { useQuery } from "@tanstack/react-query";
import { formatRelative, formatWhen } from "../../lib/format";

/**
 * The save state next to the flow name: amber while there are unsaved
 * changes, green once saved. It opens the flow's version history.
 */
export function VersionHistory({
  flowId,
  isDirty,
  savedAt,
  version,
}: {
  flowId: string;
  isDirty: boolean;
  savedAt: Date | string | null;
  version: number;
}) {
  const versions = useQuery({
    queryFn: async () => (await apiClient.flows.versions({ flowId })).data,
    queryKey: ["flow-versions", flowId, version],
  });
  const label = isDirty
    ? `Unsaved changes · v${version}`
    : `Saved · v${version}${savedAt ? ` · ${formatRelative(savedAt)}` : ""}`;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={`${label}. Show version history`}
            className="h-[26px] gap-1.5 px-2 font-normal text-[12.5px] text-muted-foreground hover:text-foreground"
            size="xs"
            variant="ghost"
          />
        }
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-[7px] rounded-full",
            isDirty ? "bg-(--status-warning-dot)" : "bg-(--status-success-dot)"
          )}
        />
        {label}
        <ChevronDown className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] gap-0 p-1.5">
        <div className="px-2 pt-2 pb-1.5 font-medium text-[11.5px] text-muted-foreground">
          Version history · each save is a version
        </div>
        {isDirty ? (
          <VersionRow
            tag="draft"
            title="Unsaved changes"
            version={version + 1}
            when="Not saved yet"
          />
        ) : null}
        {versions.isPending ? (
          <p className="px-2 py-2 text-muted-foreground text-xs">
            Loading versions…
          </p>
        ) : null}
        {versions.isError ? (
          <p className="px-2 py-2 text-(--status-danger-fg) text-xs">
            Could not load the version history.
          </p>
        ) : null}
        {versions.data?.map((entry) => (
          <VersionRow
            current={entry.version === version}
            key={entry.id}
            tag={entry.version === version ? "current" : ""}
            title={entry.createdByName ?? "Someone"}
            version={entry.version}
            when={formatWhen(entry.createdAt)}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

const VersionRow = ({
  current = false,
  tag,
  title,
  version,
  when,
}: {
  current?: boolean;
  tag: string;
  title: string;
  version: number;
  when: string;
}) => (
  <div
    className={cn(
      "flex items-center gap-2.5 rounded-md p-2",
      current && "bg-hover"
    )}
  >
    <span className="w-[26px] font-mono font-semibold text-[11.5px] text-foreground-2">
      v{version}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium text-[12.5px] leading-[1.3]">
        {title}
      </span>
      <span className="block text-[11.5px] text-muted-foreground leading-[1.3]">
        {when}
      </span>
    </span>
    <span className="font-medium text-[11px] text-muted-foreground">{tag}</span>
  </div>
);
