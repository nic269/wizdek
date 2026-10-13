"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  buttonVariants,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
} from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useActiveOrganization } from "../lib/active-organization";
import {
  FLOW_STATUS_LABELS,
  type FlowListItem,
  formatDateTime,
  RUN_STATUS_LABELS,
  RUN_STATUS_VARIANTS,
} from "./flow-labels";

export function FlowsPanel() {
  const router = useRouter();
  const {
    error: organizationError,
    isLoading,
    organization,
  } = useActiveOrganization();
  const organizationId = organization?.id;
  const [flows, setFlows] = useState<FlowListItem[] | null>(null);
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadFlows = useCallback(async () => {
    if (!organizationId) {
      return;
    }
    const { data } = await apiClient.flows.list({ organizationId });
    setFlows(data);
  }, [organizationId]);

  useEffect(() => {
    setFlows(null);
    setError(null);
    loadFlows().catch((cause: unknown) =>
      setError(getApiErrorMessage(cause, "Could not load flows."))
    );
  }, [loadFlows]);

  const attempt = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
      await loadFlows();
    } catch (cause) {
      setError(getApiErrorMessage(cause, fallback));
    }
  };

  const createFlow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const { data } = await apiClient.flows.create({ name, organizationId });
      router.push(`/flows/${data.flow.id}`);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not create the flow."));
      setIsSubmitting(false);
    }
  };

  const rename = (event: FormEvent<HTMLFormElement>, flowId: string) => {
    event.preventDefault();
    return attempt(async () => {
      await apiClient.flows.update({ flowId, name: newName });
      setRenamingId(null);
    }, "Could not rename the flow.");
  };

  if (organizationError) {
    return <ErrorState message={organizationError} />;
  }
  if (!(isLoading || organization)) {
    return (
      <EmptyState
        description="Create an organization on the dashboard first."
        title="No organization"
      />
    );
  }
  if (flows === null && !error) {
    return <LoadingState label="Loading flows" />;
  }

  const visible = (flows ?? []).filter(
    (flow) => showArchived || flow.status !== "ARCHIVED"
  );
  const archivedCount = (flows ?? []).length - visible.length;

  return (
    <div className="space-y-4">
      <form className="flex max-w-xl gap-2" onSubmit={createFlow}>
        <Input
          aria-label="Flow name"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name for a new flow"
          required
          value={name}
        />
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Creating..." : "Create flow"}
        </Button>
      </form>
      {error ? <ErrorState message={error} /> : null}
      {visible.length === 0 ? (
        <EmptyState
          description="Create a flow, then add a trigger and the steps it should run."
          title="No flows yet"
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flow</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((flow) => (
                <TableRow data-testid={`flow-${flow.name}`} key={flow.id}>
                  <TableCell>
                    {renamingId === flow.id ? (
                      <form
                        className="flex gap-2"
                        onSubmit={(event) => rename(event, flow.id)}
                      >
                        <Input
                          aria-label="New flow name"
                          maxLength={120}
                          onChange={(event) => setNewName(event.target.value)}
                          required
                          value={newName}
                        />
                        <Button size="sm" type="submit">
                          Save
                        </Button>
                      </form>
                    ) : (
                      <a
                        className="font-medium hover:underline"
                        href={`/flows/${flow.id}`}
                      >
                        {flow.name}
                      </a>
                    )}
                    {flow.description ? (
                      <p className="text-muted-foreground text-xs">
                        {flow.description}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {FLOW_STATUS_LABELS[flow.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {flow.lastRun ? (
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={RUN_STATUS_VARIANTS[flow.lastRun.status]}
                        >
                          {RUN_STATUS_LABELS[flow.lastRun.status]}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {formatDateTime(flow.lastRun.createdAt)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        Never run
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(flow.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <a
                        className={buttonVariants({
                          size: "sm",
                          variant: "outline",
                        })}
                        href={`/flows/${flow.id}`}
                      >
                        Open
                      </a>
                      <Button
                        onClick={() => {
                          setRenamingId(
                            renamingId === flow.id ? null : flow.id
                          );
                          setNewName(flow.name);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        {renamingId === flow.id ? "Cancel" : "Rename"}
                      </Button>
                      <Button
                        onClick={() =>
                          attempt(
                            () =>
                              apiClient.flows.update({
                                flowId: flow.id,
                                status:
                                  flow.status === "ARCHIVED"
                                    ? "DRAFT"
                                    : "ARCHIVED",
                              }),
                            "Could not update the flow."
                          )
                        }
                        size="sm"
                        variant="ghost"
                      >
                        {flow.status === "ARCHIVED" ? "Restore" : "Archive"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {archivedCount > 0 || showArchived ? (
        <Button
          onClick={() => setShowArchived((current) => !current)}
          size="sm"
          variant="ghost"
        >
          {showArchived
            ? "Hide archived flows"
            : `Show ${archivedCount} archived`}
        </Button>
      ) : null}
    </div>
  );
}
