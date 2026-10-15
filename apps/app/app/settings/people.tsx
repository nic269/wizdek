"use client";

import { apiClient } from "@repo/api/client";
import { cn, hueFromId, initialsOf } from "@repo/design-system";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

export type Member = Awaited<
  ReturnType<typeof apiClient.organizations.members.list>
>["data"][number];
export type Role = Awaited<
  ReturnType<typeof apiClient.organizations.roles.list>
>["data"][number];

/** Reads every page of a cursor list; members and roles stay small. */
const readAll = async <Item,>(
  load: (
    cursor: string | null
  ) => Promise<{ data: Item[]; pageInfo: { nextCursor: string | null } }>
) => {
  const items: Item[] = [];
  let cursor: string | null = null;
  do {
    const page = await load(cursor);
    items.push(...page.data);
    cursor = page.pageInfo.nextCursor;
  } while (cursor);
  return items;
};

export const peopleKeys = {
  members: (organizationId: string | null) => ["members", organizationId],
  roles: (organizationId: string | null) => ["roles", organizationId],
} as const;

export const useMembers = (organizationId: string | null, enabled: boolean) =>
  useQuery({
    enabled: Boolean(organizationId) && enabled,
    queryFn: () =>
      readAll((cursor) =>
        apiClient.organizations.members.list({
          ...(cursor ? { cursor } : {}),
          limit: 100,
          organizationId: organizationId ?? "",
        })
      ),
    queryKey: peopleKeys.members(organizationId),
  });

export const useRoles = (organizationId: string | null, enabled: boolean) =>
  useQuery({
    enabled: Boolean(organizationId) && enabled,
    queryFn: () =>
      readAll((cursor) =>
        apiClient.organizations.roles.list({
          ...(cursor ? { cursor } : {}),
          limit: 100,
          organizationId: organizationId ?? "",
        })
      ),
    queryKey: peopleKeys.roles(organizationId),
  });

/** A person's initials on a tint of a hue picked from their id. */
export const PersonAvatar = ({
  className,
  id,
  name,
  size = 32,
}: {
  className?: string | undefined;
  id: string;
  name: string;
  size?: number | undefined;
}) => {
  const hue = hueFromId(id);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold leading-none",
        className
      )}
      style={{
        background: `oklch(0.92 0.04 ${hue})`,
        color: `oklch(0.38 0.08 ${hue})`,
        fontSize: Math.round(size * 0.375),
        height: size,
        width: size,
      }}
    >
      {initialsOf(name)}
    </span>
  );
};

/** "Mar 2025": the month a member joined. */
export const formatJoined = (value: Date | string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

/** A bordered list with rounded corners that scrolls sideways on phones. */
export const ListFrame = ({
  children,
  minWidth,
}: {
  children: ReactNode;
  minWidth: number;
}) => (
  <div className="overflow-auto rounded-card border border-border bg-card">
    <div style={{ minWidth }}>{children}</div>
  </div>
);

/** A section title with a mono count after it. */
export const ListTitle = ({
  count,
  title,
}: {
  count?: number | string | undefined;
  title: string;
}) => (
  <div className="flex items-baseline gap-2">
    <h2 className="font-semibold text-[15px] leading-[1.3]">{title}</h2>
    {count === undefined ? null : (
      <span className="font-medium font-mono text-muted-foreground text-xs">
        {count}
      </span>
    )}
  </div>
);
