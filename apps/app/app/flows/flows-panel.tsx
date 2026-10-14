"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Archive,
  ArchiveRestore,
  Button,
  Ellipsis,
  EmptyState,
  ErrorAlert,
  History,
  Input,
  PageHeader,
  PencilLine,
  Plus,
  ReadOnlyBanner,
  SkeletonRows,
  StatusBadge,
  toast,
} from "@repo/design-system";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/design-system/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useActiveOrganization } from "../lib/active-organization";
import { formatRelative, formatWhen } from "../lib/format";
import { usePermissions } from "../lib/permissions";
import { type FlowListItem, queryKeys, useFlows } from "../lib/queries";
import { CategoryChip, triggerName } from "./node-visuals";

const COLUMNS = "minmax(260px,2fr) 110px minmax(220px,1.4fr) 140px 90px";

const RenameDialog = ({
  flow,
  onClose,
  onRenamed,
}: {
  flow: FlowListItem | null;
  onClose: () => void;
  onRenamed: () => void;
}) => {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  useEffect(() => {
    setName(flow?.name ?? "");
    setError(null);
  }, [flow]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!flow) {
      return;
    }
    setIsPending(true);
    try {
      await apiClient.flows.update({ flowId: flow.id, name });
      toast.success("Flow renamed", { description: name });
      onRenamed();
      onClose();
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not rename the flow."));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => (open ? null : onClose())}
      open={flow !== null}
    >
      <DialogContent className="sm:max-w-[420px]">
        <form className="flex min-h-0 flex-col" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Rename flow</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Input
              aria-label="New flow name"
              autoFocus
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
            {error ? <ErrorAlert message={error} title="Not renamed." /> : null}
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={isPending || !name.trim()} type="submit">
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const lastRunMeta = (flow: FlowListItem) => {
  if (!flow.lastRun) {
    return "Never run";
  }
  const when =
    flow.lastRun.status === "RUNNING"
      ? `started ${formatRelative(flow.lastRun.createdAt)}`
      : formatRelative(flow.lastRun.createdAt);
  return `${flow.lastRun.storeName} · ${when}`;
};

const FlowRow = ({
  canManage,
  flow,
  onRename,
  onSetStatus,
}: {
  canManage: boolean;
  flow: FlowListItem;
  onRename: () => void;
  onSetStatus: (status: "ACTIVE" | "ARCHIVED") => void;
}) => {
  const router = useRouter();
  const href = `/flows/${flow.id}`;
  return (
    <TableRow
      className="cursor-pointer data-[archived=true]:opacity-60"
      data-archived={flow.status === "ARCHIVED"}
      data-testid={`flow-row-${flow.id}`}
      onClick={() => router.push(href)}
    >
      <TableCell className="h-[62px]">
        <div className="flex min-w-0 items-center gap-[11px]">
          <CategoryChip
            category="trigger"
            className="rounded-[7px]!"
            nodeType={flow.triggerType ?? "trigger.manual"}
          />
          <div className="min-w-0">
            <Link
              className="block truncate font-semibold text-[13.5px] text-foreground leading-[1.3] hover:underline"
              href={href}
              onClick={(event) => event.stopPropagation()}
            >
              {flow.name}
            </Link>
            <div className="truncate text-muted-foreground text-xs leading-[1.4]">
              {triggerName(flow.triggerType)} · {flow.stepCount} steps ·{" "}
              {flow.version === null ? "not saved" : `v${flow.version}`}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={flow.status} />
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          {flow.lastRun ? (
            <StatusBadge status={flow.lastRun.status} />
          ) : (
            <StatusBadge tone="neutral">No runs</StatusBadge>
          )}
          <span className="truncate text-muted-foreground text-xs">
            {lastRunMeta(flow)}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-[12.5px] text-muted-foreground">
        <span title={formatWhen(flow.updatedAt)}>
          {formatWhen(flow.updatedAt)}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-0.5">
          <Link
            aria-label={`Runs of ${flow.name}`}
            className="grid size-[30px] place-items-center rounded-lg text-muted-foreground hover:bg-border hover:text-foreground"
            href={`/flows/${flow.id}/runs`}
            onClick={(event) => event.stopPropagation()}
            title="Runs"
          >
            <History className="size-[15px]" />
          </Link>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={`More actions for ${flow.name}`}
                    className="text-muted-foreground hover:bg-border"
                    onClick={(event) => event.stopPropagation()}
                    size="icon-sm"
                    title="More"
                    variant="ghost"
                  />
                }
              >
                <Ellipsis className="size-[15px]" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-44"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem onClick={onRename}>
                  <PencilLine />
                  Rename
                </DropdownMenuItem>
                {flow.status === "ARCHIVED" ? (
                  <DropdownMenuItem onClick={() => onSetStatus("ACTIVE")}>
                    <ArchiveRestore />
                    Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onSetStatus("ARCHIVED")}>
                    <Archive />
                    Archive
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
};

const FlowTable = ({
  canManage,
  flows,
  isLoading,
  onRename,
  onSetStatus,
}: {
  canManage: boolean;
  flows: FlowListItem[];
  isLoading: boolean;
  onRename: (flow: FlowListItem) => void;
  onSetStatus: (flow: FlowListItem, status: "ACTIVE" | "ARCHIVED") => void;
}) => (
  <Table className="min-w-[860px] table-fixed">
    <TableHeader>
      <TableRow>
        <TableHead>Flow</TableHead>
        <TableHead className="w-[126px]">Status</TableHead>
        <TableHead className="w-[30%]">Last run</TableHead>
        <TableHead className="w-[156px]">Updated</TableHead>
        <TableHead className="w-[106px]">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {isLoading ? (
        <TableRow className="hover:bg-transparent">
          <TableCell className="h-auto p-0" colSpan={5}>
            <SkeletonRows columns={COLUMNS} label="Loading flows" />
          </TableCell>
        </TableRow>
      ) : (
        flows.map((flow) => (
          <FlowRow
            canManage={canManage}
            flow={flow}
            key={flow.id}
            onRename={() => onRename(flow)}
            onSetStatus={(status) => onSetStatus(flow, status)}
          />
        ))
      )}
    </TableBody>
  </Table>
);

const FlowsReadOnlyBanner = ({ canRun }: { canRun: boolean }) => (
  <ReadOnlyBanner>
    {canRun ? (
      <>
        You can run flows, but only people with the{" "}
        <strong>Manage flows</strong> permission can create or edit them.
      </>
    ) : (
      <>
        You can view flows and their runs, but not edit or run them. Ask an
        Owner for the <strong>Run flows</strong> permission to start runs.
      </>
    )}
  </ReadOnlyBanner>
);

const FlowsEmpty = ({
  canManage,
  onCreate,
}: {
  canManage: boolean;
  onCreate: () => void;
}) => (
  <EmptyState
    action={
      canManage ? (
        <Button onClick={onCreate}>Create your first flow</Button>
      ) : undefined
    }
    description="Chain a trigger, data steps and Shopify actions — like tagging every order from a CSV whose total is over 1,000."
    icon={
      <span className="flex gap-1.5">
        <CategoryChip category="trigger" nodeType="trigger.manual" />
        <CategoryChip category="data" nodeType="data.parseCsv" />
        <CategoryChip category="action" nodeType="shopify.addTags" />
      </span>
    }
    iconTile={false}
    note={
      canManage
        ? undefined
        : "Only people who can manage flows can create them."
    }
    title="No flows yet"
  />
);

/** The list's state, kept out of the panel so it stays readable. */
const listState = (
  flows: FlowListItem[] | undefined,
  showArchived: boolean
) => {
  const all = flows ?? [];
  return {
    all,
    archivedCount: all.filter(({ status }) => status === "ARCHIVED").length,
    visible: all.filter((flow) => showArchived || flow.status !== "ARCHIVED"),
  };
};

export function FlowsPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { organization } = useActiveOrganization();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const organizationId = organization?.id ?? null;
  const flows = useFlows(organizationId);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<FlowListItem | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const canManage = can("flows:manage");
  const canRun = can("flows:run");

  // "New flow" elsewhere in the app lands here with the name field focused.
  useEffect(() => {
    if (searchParams.get("new") && canManage) {
      nameInput.current?.focus();
    }
  }, [canManage, searchParams]);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.flows(organizationId),
    });

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId) {
      return;
    }
    setCreateError(null);
    setIsCreating(true);
    const flowName = name.trim() || "Untitled flow";
    try {
      const { data } = await apiClient.flows.create({
        name: flowName,
        organizationId,
      });
      toast.success("Flow created", { description: `${flowName} · Draft` });
      router.push(`/flows/${data.flow.id}`);
    } catch (cause) {
      setCreateError(getApiErrorMessage(cause, "Could not create the flow."));
      setIsCreating(false);
    }
  };

  const setStatus = async (
    flow: FlowListItem,
    status: "ACTIVE" | "ARCHIVED"
  ) => {
    try {
      await apiClient.flows.update({ flowId: flow.id, status });
      toast.success(status === "ARCHIVED" ? "Flow archived" : "Flow restored", {
        description: flow.name,
      });
      await refresh();
    } catch (cause) {
      toast.error("Could not update the flow", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    }
  };

  const { all, archivedCount, visible } = listState(flows.data, showArchived);
  const isLoading = flows.isLoading || permissionsLoading;

  return (
    <>
      <PageHeader
        actions={
          canManage ? (
            <form className="flex gap-2" onSubmit={create}>
              <Input
                aria-label="Flow name"
                className="w-[240px]"
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name for a new flow"
                ref={nameInput}
                value={name}
              />
              <Button disabled={isCreating} type="submit">
                <Plus />
                {isCreating ? "Creating…" : "Create flow"}
              </Button>
            </form>
          ) : null
        }
        description="Automations that run against a connected store, one item at a time, with a full per-step trace."
        title="Flows"
      />

      {permissionsLoading || canManage ? null : (
        <FlowsReadOnlyBanner canRun={canRun} />
      )}

      {createError ? (
        <ErrorAlert message={createError} title="Couldn't create the flow." />
      ) : null}
      {flows.isError ? (
        <ErrorAlert
          message="Running flows are not affected."
          onRetry={() => flows.refetch()}
          title="Couldn't load flows."
        />
      ) : null}

      {!(isLoading || flows.isError) && all.length === 0 ? (
        <FlowsEmpty
          canManage={canManage}
          onCreate={() => nameInput.current?.focus()}
        />
      ) : null}

      {flows.isError || (!isLoading && all.length === 0) ? null : (
        <FlowTable
          canManage={canManage}
          flows={visible}
          isLoading={isLoading}
          onRename={setRenaming}
          onSetStatus={setStatus}
        />
      )}

      {!isLoading && archivedCount > 0 ? (
        <Button
          className="self-start px-0 text-[12.5px] text-muted-foreground hover:bg-transparent hover:text-foreground"
          onClick={() => setShowArchived((current) => !current)}
          size="xs"
          variant="ghost"
        >
          <Archive className="size-3.5" />
          {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
        </Button>
      ) : null}

      <RenameDialog
        flow={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={refresh}
      />
    </>
  );
}
