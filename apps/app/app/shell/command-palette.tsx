"use client";

import { appConfig } from "@repo/config";
import {
  Braces,
  Database,
  HardDriveDownload,
  Plus,
  Store,
  UserPlus,
  Workflow,
} from "@repo/design-system";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/design-system/components/ui/command";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useActiveOrganization } from "../lib/active-organization";
import { type Permission, usePermissions } from "../lib/permissions";
import { useDatabaseConnections, useFlows, useStores } from "../lib/queries";
import type { ShellNavGroup } from "./nav";

interface Entry {
  hint: string;
  href: string;
  icon: ReactNode;
  label: string;
  permission?: Permission;
}

const ACTIONS: Entry[] = [
  {
    hint: "Stores",
    href: "/stores/new",
    icon: <Plus />,
    label: "Connect a store",
    permission: "stores:manage",
  },
  {
    hint: "Console",
    href: "/graphql",
    icon: <Braces />,
    label: "New GraphQL query",
    permission: "graphql:query",
  },
  {
    hint: "Flows",
    href: "/flows?new=1",
    icon: <Workflow />,
    label: "Create a flow",
    permission: "flows:manage",
  },
  {
    hint: "Database",
    href: "/database?new=1",
    icon: <Database />,
    label: "Add a database connection",
    permission: "databases:manage",
  },
  {
    hint: "Members",
    href: "/settings/members",
    icon: <UserPlus />,
    label: "Invite a member",
    permission: "members:invite",
  },
];

const Row = ({
  entry,
  onPick,
}: {
  entry: Entry;
  onPick: (href: string) => void;
}) => (
  <CommandItem
    onSelect={() => onPick(entry.href)}
    value={`${entry.label} ${entry.hint}`}
  >
    {entry.icon}
    <span className="flex-1 truncate">{entry.label}</span>
    <span className="font-normal text-muted-foreground text-xs">
      {entry.hint}
    </span>
  </CommandItem>
);

/** ⌘K: jump to a page, store, flow or database, or start an action. */
export const CommandPalette = ({
  navGroups,
  onOpenChange,
  open,
}: {
  navGroups: readonly ShellNavGroup[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => {
  const router = useRouter();
  const { organization } = useActiveOrganization();
  const { can } = usePermissions();
  const organizationId = organization?.id ?? null;
  const stores = useStores(organizationId, open && can("stores:read"));
  const flows = useFlows(organizationId, open && can("flows:read"));
  const databases = useDatabaseConnections(
    organizationId,
    open && can("databases:read")
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  const pick = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const pages: Entry[] = navGroups.flatMap(({ items }) =>
    items.map((item) => ({
      hint: "Page",
      href: item.href,
      icon: item.icon,
      label: item.label,
    }))
  );
  const actions = ACTIONS.filter(
    ({ permission }) => !permission || can(permission)
  );

  return (
    <CommandDialog
      description={`Search ${appConfig.name}`}
      onOpenChange={onOpenChange}
      open={open}
      title="Search or jump to"
    >
      <Command>
        <CommandInput
          endAdornment={
            <kbd className="rounded border border-border px-[5px] py-[3px] font-medium font-mono text-[10.5px] text-muted-foreground leading-none">
              esc
            </kbd>
          }
          placeholder="Jump to a page, store, flow or action…"
        />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          <CommandGroup heading="Pages">
            {pages.map((entry) => (
              <Row entry={entry} key={entry.href} onPick={pick} />
            ))}
          </CommandGroup>
          {actions.length > 0 ? (
            <CommandGroup heading="Actions">
              {actions.map((entry) => (
                <Row entry={entry} key={entry.label} onPick={pick} />
              ))}
            </CommandGroup>
          ) : null}
          {stores.data?.length ? (
            <CommandGroup heading="Stores">
              {stores.data.map((store) => (
                <Row
                  entry={{
                    hint: store.shopDomain,
                    href: `/stores?store=${store.id}`,
                    icon: <Store />,
                    label: store.name,
                  }}
                  key={store.id}
                  onPick={pick}
                />
              ))}
            </CommandGroup>
          ) : null}
          {flows.data?.length ? (
            <CommandGroup heading="Flows">
              {flows.data
                .filter(({ status }) => status !== "ARCHIVED")
                .map((flow) => (
                  <Row
                    entry={{
                      hint: "Flow",
                      href: `/flows/${flow.id}`,
                      icon: <Workflow />,
                      label: `Open flow: ${flow.name}`,
                    }}
                    key={flow.id}
                    onPick={pick}
                  />
                ))}
            </CommandGroup>
          ) : null}
          {databases.data?.length ? (
            <CommandGroup heading="Databases">
              {databases.data.map((connection) => (
                <Row
                  entry={{
                    hint: "Database",
                    href: `/database/${connection.id}`,
                    icon: <HardDriveDownload />,
                    label: connection.name,
                  }}
                  key={connection.id}
                  onPick={pick}
                />
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
};
