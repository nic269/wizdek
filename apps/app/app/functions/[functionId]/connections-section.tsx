"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { Button, ErrorAlert, Input, Trash2, toast } from "@repo/design-system";
import { aliasOf, type GrantKind } from "@repo/functions/definition";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Field } from "../../lib/form-parts";
import { OptionSelect } from "../../lib/option-select";
import { usePermissions } from "../../lib/permissions";

const grantsKey = (functionId: string) =>
  ["function-grants", functionId] as const;

const KIND_LABELS: Record<GrantKind, string> = {
  DATABASE: "Database",
  STORE: "Store",
};

interface Resource {
  detail: string;
  id: string;
  name: string;
}

/** The stores and databases of the organization the person may grant. */
const useGrantableResources = (organizationId: string, enabled: boolean) => {
  const { can } = usePermissions();
  const canGrantStores = can("stores:read") && can("graphql:mutate");
  const canGrantDatabases = can("databases:read");
  const stores = useQuery({
    enabled: enabled && canGrantStores,
    queryFn: async () =>
      (await apiClient.shopifyStores.list({ organizationId })).data
        .filter((store) => store.status !== "DISCONNECTED")
        .map(
          (store): Resource => ({
            detail: store.shopDomain,
            id: store.id,
            name: store.name,
          })
        ),
    queryKey: ["function-grant-stores", organizationId],
  });
  const databases = useQuery({
    enabled: enabled && canGrantDatabases,
    queryFn: async () =>
      (await apiClient.databaseConnections.list({ organizationId })).data.map(
        (connection): Resource => ({
          detail: `${connection.environment} · ${connection.databaseName}`,
          id: connection.id,
          name: connection.name,
        })
      ),
    queryKey: ["function-grant-databases", organizationId],
  });
  return {
    DATABASE: canGrantDatabases ? (databases.data ?? []) : null,
    STORE: canGrantStores ? (stores.data ?? []) : null,
  } satisfies Record<GrantKind, Resource[] | null>;
};

type Grant = Awaited<
  ReturnType<typeof apiClient.functions.listGrants>
>["data"][number];

function GrantList({
  canManage,
  grants,
  onRemoved,
}: {
  canManage: boolean;
  grants: Grant[];
  onRemoved: () => Promise<unknown>;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = async (grant: Grant) => {
    setRemoving(grant.id);
    try {
      await apiClient.functions.removeGrant({ grantId: grant.id });
      toast.success("Connection removed", { description: grant.alias });
      await onRemoved();
    } catch (cause) {
      toast.error("Could not remove the connection", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setRemoving(null);
    }
  };
  if (grants.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">No connections yet.</p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {grants.map((grant) => (
        <li
          className="flex items-center justify-between gap-2 px-3 py-2"
          data-testid="function-grant"
          key={grant.id}
        >
          <div className="min-w-0">
            <p className="truncate font-mono text-[12.5px]">{grant.alias}</p>
            <p className="truncate text-[11.5px] text-muted-foreground">
              {KIND_LABELS[grant.kind]} · {grant.resourceName ?? "Deleted"}
              {grant.detail ? ` · ${grant.detail}` : ""}
            </p>
          </div>
          {canManage ? (
            <Button
              aria-label={`Remove ${grant.alias}`}
              disabled={removing === grant.id}
              onClick={() => remove(grant)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AddGrantForm({
  functionId,
  grants,
  onAdded,
  resources,
}: {
  functionId: string;
  grants: Grant[];
  onAdded: () => Promise<unknown>;
  resources: Record<GrantKind, Resource[] | null>;
}) {
  const kinds = (Object.keys(KIND_LABELS) as GrantKind[]).filter(
    (candidate) => resources[candidate] !== null
  );
  const [picked, setPicked] = useState<GrantKind | "">("");
  const [resourceId, setResourceId] = useState("");
  const [alias, setAlias] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const kind = picked || kinds[0];
  if (!kind) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        You need permission to view stores and run GraphQL mutations, or to view
        database connections, to add one.
      </p>
    );
  }
  const taken = new Set(
    grants.filter((grant) => grant.kind === kind).map((g) => g.resourceId)
  );
  const choices = (resources[kind] ?? []).filter(
    (resource) => !taken.has(resource.id)
  );
  const chosen = choices.find((resource) => resource.id === resourceId);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!chosen) {
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      const { data } = await apiClient.functions.addGrant({
        alias: alias.trim() || undefined,
        functionId,
        kind,
        resourceId: chosen.id,
      });
      toast.success("Connection added", { description: data.alias });
      setResourceId("");
      setAlias("");
      await onAdded();
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not add the connection."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <Field label="Kind">
          <OptionSelect
            aria-label="Connection kind"
            onValueChange={(value) => {
              setPicked(value);
              setResourceId("");
            }}
            options={kinds.map((value) => ({
              label: KIND_LABELS[value],
              value,
            }))}
            value={kind}
          />
        </Field>
        <Field label={kind === "STORE" ? "Store" : "Database"}>
          <OptionSelect
            aria-label="Connection resource"
            disabled={choices.length === 0}
            onValueChange={(value) => setResourceId(value)}
            options={choices.map((resource) => ({
              label: `${resource.name} · ${resource.detail}`,
              value: resource.id,
            }))}
            placeholder={choices.length === 0 ? "None left" : "Choose…"}
            value={resourceId}
          />
        </Field>
      </div>
      <Field hint="How the code names it." label="Alias">
        <Input
          aria-label="Connection alias"
          className="font-mono"
          maxLength={40}
          onChange={(event) => setAlias(event.target.value.toLowerCase())}
          placeholder={chosen ? aliasOf(chosen.name) : "main-store"}
          value={alias}
        />
      </Field>
      {error ? <ErrorAlert message={error} title="Not added." /> : null}
      <Button disabled={isSaving || !chosen} size="sm" type="submit">
        {isSaving ? "Adding…" : "Add connection"}
      </Button>
    </form>
  );
}

/**
 * The stores and databases a function may reach through the `wizdek`
 * helpers, by the alias its code uses.
 */
export function ConnectionsSection({
  canManage,
  functionId,
  organizationId,
}: {
  canManage: boolean;
  functionId: string;
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const grants = useQuery({
    queryFn: async () =>
      (await apiClient.functions.listGrants({ functionId })).data,
    queryKey: grantsKey(functionId),
  });
  const resources = useGrantableResources(organizationId, canManage);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: grantsKey(functionId) });

  return (
    <section
      className="space-y-3 border-border border-t pt-4"
      data-testid="function-connections"
    >
      <h3 className="font-semibold text-[13px]">Connections</h3>
      <p className="text-[12.5px] text-muted-foreground">
        Stores and databases this function may use, whatever starts it, e.g.{" "}
        <code className="font-mono">db("analytics")</code> or{" "}
        <code className="font-mono">shopify("main-store")</code> from{" "}
        <code className="font-mono">wizdek</code>. Writes and mutations are
        audited.
      </p>
      {grants.error ? (
        <ErrorAlert
          message={getApiErrorMessage(
            grants.error,
            "Could not load the connections."
          )}
          title="Not loaded."
        />
      ) : null}
      {grants.data ? (
        <GrantList
          canManage={canManage}
          grants={grants.data}
          onRemoved={refresh}
        />
      ) : null}
      {canManage && grants.data ? (
        <AddGrantForm
          functionId={functionId}
          grants={grants.data}
          onAdded={refresh}
          resources={resources}
        />
      ) : null}
    </section>
  );
}
