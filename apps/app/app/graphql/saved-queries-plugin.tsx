"use client";

import { useGraphiQL } from "@graphiql/react";
import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  cn,
  Ellipsis,
  Input,
  Search,
  SectionLabel,
  toast,
} from "@repo/design-system";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/design-system/components/ui/dropdown-menu";
import type { GraphiQLProps } from "graphiql";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatRelative } from "../lib/format";
import { operationOf } from "./operation-kind";

type Plugin = NonNullable<GraphiQLProps["plugins"]>[number];

type SavedQuery = Awaited<
  ReturnType<typeof apiClient.savedQueries.list>
>["data"][number];

function SavedQueriesIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="1em"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="1em"
    >
      <title>Saved queries</title>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

const KIND_BADGES = {
  mutation: "bg-(--status-warning-bg) text-(--status-warning-fg)",
  query: "bg-(--status-info-bg) text-(--status-info-fg)",
  subscription: "bg-(--status-neutral-bg) text-(--status-neutral-fg)",
} as const;

/** Q or M, coloured like the Run button: queries blue, mutations amber. */
export const KindBadge = ({ query }: { query: string }) => {
  const { kind } = operationOf(query);
  return (
    <span
      className={cn(
        "flex-none rounded-[3px] px-1 font-mono font-semibold text-[9.5px] leading-4",
        KIND_BADGES[kind]
      )}
      title={kind}
    >
      {kind === "mutation" ? "M" : "Q"}
    </span>
  );
};

const SavedRow = ({
  onDelete,
  onLoad,
  onRename,
  savedQuery,
}: {
  onDelete: () => void;
  onLoad: () => void;
  onRename: (name: string) => Promise<boolean>;
  savedQuery: SavedQuery;
}) => {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(savedQuery.name);
  if (renaming) {
    return (
      <form
        className="flex gap-1.5 px-1.5 py-1"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await onRename(name)) {
            setRenaming(false);
          }
        }}
      >
        <Input
          aria-label="New name"
          autoFocus
          className="h-[30px] text-[12.5px]"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <Button size="sm" type="submit">
          Rename
        </Button>
      </form>
    );
  }
  return (
    <div className="group flex items-start gap-1 rounded-md hover:bg-hover">
      <Button
        aria-label={`Load ${savedQuery.name}`}
        className="h-auto min-w-0 flex-1 items-start justify-start gap-2 px-1.5 py-[7px] text-left font-normal hover:bg-transparent"
        onClick={onLoad}
        variant="ghost"
      >
        <KindBadge query={savedQuery.query} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium font-mono text-[12.5px] leading-[1.3]">
            {savedQuery.name}
          </span>
          <span className="block text-[11.5px] text-muted-foreground leading-[1.35]">
            {formatRelative(savedQuery.updatedAt)}
          </span>
        </span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`More actions for ${savedQuery.name}`}
              className="mt-1 size-6 text-muted-foreground opacity-0 group-hover:opacity-100 aria-expanded:opacity-100"
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <Ellipsis className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={onLoad}>Load</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-(--status-danger-fg)"
            onClick={onDelete}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

function SavedQueriesPanel({
  organizationId,
  organizationName,
  userId,
}: {
  organizationId: string;
  organizationName: string;
  userId: string;
}) {
  const queryEditor = useGraphiQL((state) => state.queryEditor);
  const variableEditor = useGraphiQL((state) => state.variableEditor);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await apiClient.savedQueries.list({ organizationId });
    setSavedQueries(data);
  }, [organizationId]);

  const attempt = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (cause) {
      setError(getApiErrorMessage(cause, fallback));
      return false;
    }
  };

  useEffect(() => {
    load().catch((cause: unknown) =>
      setError(getApiErrorMessage(cause, "Could not load saved queries."))
    );
  }, [load]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = queryEditor?.getValue() ?? "";
    const variables = variableEditor?.getValue() ?? "";
    if (!query.trim()) {
      setError("Write a query before saving it.");
      return;
    }
    const saved = await attempt(async () => {
      await apiClient.savedQueries.create({
        name,
        organizationId,
        query,
        ...(variables.trim() ? { variables } : {}),
      });
    }, "Could not save the query.");
    if (saved) {
      toast.success("Query saved", {
        description: `Shared with everyone in ${organizationName}.`,
      });
      setName("");
    }
  };

  const needle = filter.trim().toLowerCase();
  const visible = savedQueries.filter(
    (savedQuery) => !needle || savedQuery.name.toLowerCase().includes(needle)
  );
  const groups = [
    {
      label: `Shared in ${organizationName}`,
      rows: visible.filter(({ createdById }) => createdById !== userId),
    },
    {
      label: "Mine",
      rows: visible.filter(({ createdById }) => createdById === userId),
    },
  ].filter(({ rows }) => rows.length > 0);

  const row = (savedQuery: SavedQuery) => (
    <SavedRow
      key={savedQuery.id}
      onDelete={() =>
        attempt(
          () =>
            apiClient.savedQueries.delete({
              organizationId,
              savedQueryId: savedQuery.id,
            }),
          "Could not delete the query."
        )
      }
      onLoad={() => {
        queryEditor?.setValue(savedQuery.query);
        variableEditor?.setValue(savedQuery.variables ?? "");
      }}
      onRename={(newName) =>
        attempt(
          () =>
            apiClient.savedQueries.update({
              name: newName,
              organizationId,
              savedQueryId: savedQuery.id,
            }),
          "Could not rename the query."
        )
      }
      savedQuery={savedQuery}
    />
  );

  return (
    <div className="wizdek-saved-queries flex flex-col gap-2.5 text-sm">
      <h2 className="font-semibold text-[13px] leading-none">Saved queries</h2>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2 left-2 size-[13px] text-muted-foreground" />
        <Input
          aria-label="Filter saved queries"
          className="h-[30px] pl-[27px] text-[12.5px]"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter"
          type="search"
          value={filter}
        />
      </div>
      <form className="flex gap-1.5" onSubmit={save}>
        <Input
          aria-label="Saved query name"
          className="h-[30px] text-[12.5px]"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name the current query"
          required
          value={name}
        />
        <Button size="sm" type="submit">
          Save
        </Button>
      </form>
      {error ? (
        <p className="text-(--status-danger-fg) text-xs">{error}</p>
      ) : null}
      {savedQueries.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nothing saved yet.</p>
      ) : null}
      {groups.map((group) => (
        <section key={group.label}>
          <SectionLabel className="px-1.5 pt-3 pb-1.5">
            {group.label}
          </SectionLabel>
          {group.rows.map(row)}
        </section>
      ))}
    </div>
  );
}

/** A GraphiQL sidebar plugin listing the organization's shared queries. */
export const createSavedQueriesPlugin = (options: {
  organizationId: string;
  organizationName: string;
  userId: string;
}): Plugin => ({
  content: () => <SavedQueriesPanel {...options} />,
  icon: SavedQueriesIcon,
  title: "Saved queries",
});
