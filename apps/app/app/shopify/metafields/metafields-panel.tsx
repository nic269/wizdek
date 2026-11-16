"use client";

import {
  Button,
  Ellipsis,
  ErrorAlert,
  InlineAlert,
  Input,
  PageHeader,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  ShellActions,
  ShellHeader,
  Trash2,
} from "@repo/design-system";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  Field,
  FieldGroup,
  FieldLabel,
} from "@repo/design-system/components/ui/field";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/design-system/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Fragment, type ReactNode, useRef, useState } from "react";
import { useActiveOrganization } from "../../lib/active-organization";
import { OptionSelect } from "../../lib/option-select";
import { usePermissions } from "../../lib/permissions";
import { type Store, useStores } from "../../lib/queries";
import { CopyDefinitions } from "./copy-definitions";
import { typeLabel } from "./metafield-types";
import {
  CREATE,
  checkMutation,
  DELETE,
  type Definition,
  type Draft,
  execute,
  listDefinitions,
  type MutationPayload,
  newDraft,
  UPDATE,
  validateDrafts,
} from "./metafields-api";
import { MetaobjectPicker } from "./metaobject-picker";
import { needsMetaobject, referenceValidations } from "./metaobject-validation";
import { TypePicker, ValueModePicker } from "./type-picker";

const OWNERS = [
  { label: "Products", value: "PRODUCT" },
  { label: "Product variants", value: "PRODUCTVARIANT" },
  { label: "Collections", value: "COLLECTION" },
  { label: "Customers", value: "CUSTOMER" },
  { label: "Orders", value: "ORDER" },
  { label: "Draft orders", value: "DRAFTORDER" },
  { label: "Pages", value: "PAGE" },
  { label: "Blogs", value: "BLOG" },
  { label: "Blog posts", value: "ARTICLE" },
  { label: "Shop", value: "SHOP" },
  { label: "Locations", value: "LOCATION" },
  { label: "Companies", value: "COMPANY" },
  { label: "Company locations", value: "COMPANY_LOCATION" },
];
const ownerLabel = (value: string) =>
  OWNERS.find((owner) => owner.value === value)?.label ?? value;
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed. Please try again.";

const countLabel = (search: string, shown: number, total: number) =>
  search ? `${shown} of ${total} definitions` : `${total} definitions`;

export function MetafieldsPanel() {
  const { organization } = useActiveOrganization();
  const { can, isLoading } = usePermissions();
  const stores = useStores(organization?.id ?? null, can("stores:read"));
  if (isLoading || !organization) {
    return <p role="status">Loading permissions…</p>;
  }
  if (!(can("graphql:query") && can("stores:read"))) {
    return (
      <p>
        You need stores:read and graphql:query permissions to manage metafields.
      </p>
    );
  }
  if (stores.isPending) {
    return <p role="status">Loading stores…</p>;
  }
  if (stores.error) {
    return <p role="alert">{message(stores.error)}</p>;
  }
  return (
    <StorePicker
      canMutate={can("graphql:mutate")}
      key={organization.id}
      stores={stores.data ?? []}
    />
  );
}

function StorePicker({
  stores,
  canMutate,
}: {
  stores: Store[];
  canMutate: boolean;
}) {
  const [storeId, setStoreId] = useState("");
  const [ownerType, setOwnerType] = useState("PRODUCT");
  const [busy, setBusy] = useState(false);
  const store = stores.find(
    (item) => item.id === storeId && item.status === "CONNECTED"
  );
  return (
    <>
      <ShellHeader
        context={
          <div className="flex items-center gap-2">
            <label
              className="text-[10.5px] text-faint uppercase tracking-[0.05em]"
              htmlFor="metafields-store"
            >
              Store
            </label>
            <OptionSelect
              className="h-[30px] w-auto min-w-56"
              disabled={busy}
              id="metafields-store"
              onValueChange={setStoreId}
              options={stores.map((item) => ({
                disabled: item.status !== "CONNECTED",
                label: `${item.name} · ${item.shopDomain} · ${item.environment}${item.status === "CONNECTED" ? "" : ` · ${item.status}`}`,
                value: item.id,
              }))}
              placeholder="Choose a store"
              value={storeId || null}
            />
          </div>
        }
        crumbs={[{ label: "Shopify" }, { label: "Metafields" }]}
      />
      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav
          aria-label="Resource"
          className="flex flex-col gap-0.5 md:border-border md:border-r md:pr-3"
        >
          <span className="px-2 pb-2 font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
            Resource
          </span>
          {OWNERS.map((owner) => (
            <button
              aria-current={owner.value === ownerType ? "page" : undefined}
              className="flex h-8 items-center rounded-md px-2 text-left text-[13px] text-foreground-2 hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-[current=page]:bg-card aria-[current=page]:font-[550] aria-[current=page]:text-foreground aria-[current=page]:shadow-(--sidebar-active-shadow)"
              disabled={busy}
              key={owner.value}
              onClick={() => setOwnerType(owner.value)}
              type="button"
            >
              {owner.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          <PageHeader
            description="Manage definitions for one store. Create multiple fields in one pass, without opening a separate form for each."
            title={`${ownerLabel(ownerType)} definitions`}
          />
          {stores.length === 0 ? (
            <p>
              No stores yet.{" "}
              <Link className="underline" href="/stores/new">
                Connect a store
              </Link>{" "}
              to get started.
            </p>
          ) : null}
          {store ? (
            <DefinitionManager
              canMutate={canMutate}
              key={`${store.id}:${ownerType}`}
              onBusy={setBusy}
              ownerType={ownerType}
              store={store}
              stores={stores}
            />
          ) : (
            <p className="rounded-card bg-sunken p-[18px] text-center text-[13px] text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
              Choose a connected store to view its metafield definitions.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function DefinitionManager({
  stores,
  store,
  ownerType,
  canMutate,
  onBusy,
}: {
  stores: Store[];
  store: Store;
  ownerType: string;
  canMutate: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Definition | null>(null);
  const [deleting, setDeleting] = useState<Definition | null>(null);
  const [deleteValues, setDeleteValues] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const definitions = useQuery({
    queryFn: () => listDefinitions(store.id, ownerType),
    queryKey: [
      "metafield-definitions",
      store.organizationId,
      store.id,
      ownerType,
    ],
  });
  const allDefinitions = definitions.data ?? [];
  const types = useQuery({
    queryFn: async () =>
      (
        await execute<{ metafieldDefinitionTypes: { name: string }[] }>(
          store.id,
          "query DefinitionTypes { metafieldDefinitionTypes { name } }"
        )
      ).metafieldDefinitionTypes,
    queryKey: ["metafield-types", store.organizationId, store.id],
  });
  const run = async (action: () => Promise<void>) => {
    if (lock.current || !canMutate) {
      return;
    }
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await definitions.refetch();
    } catch (failure) {
      setError(message(failure));
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  const visible = allDefinitions.filter((item) =>
    `${item.name} ${item.namespace}.${item.key}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const selectedDefinitions = allDefinitions.filter((item) =>
    selectedIds.has(item.id)
  );
  const locked = !canMutate || busy;
  return (
    <>
      {canMutate ? null : (
        <InlineAlert tone="neutral">
          Read-only access. Creating, editing and deleting requires
          graphql:mutate permission.
        </InlineAlert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[300px]">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
          />
          <Input
            aria-label="Search definitions"
            className="pl-8"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or namespace.key"
            value={search}
          />
        </div>
        <span className="flex-1" />
        <span className="text-faint text-xs tabular-nums">
          {countLabel(search, visible.length, allDefinitions.length)}
        </span>
        <ShellActions>
          <Button
            aria-label="Refresh definitions"
            disabled={busy || definitions.isFetching}
            onClick={() => {
              definitions.refetch();
              types.refetch();
            }}
            size="icon"
            title="Refresh definitions"
            variant="ghost"
          >
            <RefreshCw
              className={definitions.isFetching ? "animate-spin" : ""}
            />
          </Button>
          <CopyDefinitions
            disabled={locked}
            onBusy={(value) => {
              setBusy(value);
              onBusy(value);
            }}
            ownerType={ownerType}
            selected={selectedDefinitions}
            source={store}
            stores={stores}
          />
          <Button
            disabled={!canMutate || busy || !types.data}
            onClick={() => {
              setError("");
              setCreating(true);
            }}
          >
            <Plus />
            Create definitions
          </Button>
        </ShellActions>
      </div>
      <Feedback
        definitionsError={definitions.error}
        error={error}
        notice={notice}
        typesError={types.error}
      />
      <DefinitionsTable
        disabled={locked}
        error={Boolean(definitions.error)}
        loading={definitions.isPending}
        onDelete={(item) => {
          setError("");
          setDeleteValues(false);
          setConfirmation("");
          setDeleting(item);
        }}
        onEdit={(item) => {
          setError("");
          setEditing({ ...item });
        }}
        onSelectionChange={setSelectedIds}
        search={search}
        selectedIds={selectedIds}
        visible={visible}
      />
      <BulkBar
        count={selectedDefinitions.length}
        onClear={() => setSelectedIds(new Set())}
      >
        <CopyDefinitions
          disabled={locked}
          onBusy={(value) => {
            setBusy(value);
            onBusy(value);
          }}
          onDark
          ownerType={ownerType}
          selected={selectedDefinitions}
          source={store}
          stores={stores}
        />
      </BulkBar>
      <Dialog
        onOpenChange={(open) => {
          if (!busy) {
            setCreating(open);
          }
        }}
        open={creating}
      >
        <DialogContent className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Create definitions</DialogTitle>
            <DialogDescription>
              {store.shopDomain} · {ownerLabel(ownerType)} · Add up to 50 rows.
              Each row is saved separately; successful rows will not be sent
              again.
            </DialogDescription>
          </DialogHeader>
          {creating ? (
            <BatchEditor
              busy={busy}
              canMutate={canMutate}
              onClose={() => setCreating(false)}
              ownerType={ownerType}
              run={run}
              storeId={store.id}
              types={types.data ?? []}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setEditing(null);
          }
        }}
        open={Boolean(editing)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit definition</DialogTitle>
            <DialogDescription>
              {store.shopDomain} · {editing?.namespace}.{editing?.key}.
              Namespace, key and type cannot be changed here.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <form
              className="flex flex-col gap-4 overflow-y-auto p-5"
              onSubmit={(event) => {
                event.preventDefault();
                const current = editing;
                run(async () => {
                  const data = await execute<{
                    metafieldDefinitionUpdate: MutationPayload;
                  }>(store.id, UPDATE, {
                    definition: {
                      description: current.description ?? "",
                      key: current.key,
                      name: current.name.trim(),
                      namespace: current.namespace,
                      ownerType,
                    },
                  });
                  checkMutation(data.metafieldDefinitionUpdate);
                  setEditing(null);
                  setNotice("Definition updated.");
                });
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="definition-name">Name</FieldLabel>
                  <Input
                    disabled={busy}
                    id="definition-name"
                    maxLength={255}
                    onChange={(event) =>
                      setEditing({ ...editing, name: event.target.value })
                    }
                    required
                    value={editing.name}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="definition-description">
                    Description
                  </FieldLabel>
                  <Input
                    disabled={busy}
                    id="definition-description"
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        description: event.target.value,
                      })
                    }
                    value={editing.description ?? ""}
                  />
                </Field>
              </FieldGroup>
              {error ? <p role="alert">{error}</p> : null}
              <Button
                disabled={busy || !canMutate || !editing.name.trim()}
                type="submit"
              >
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setDeleting(null);
          }
        }}
        open={Boolean(deleting)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete definition?</DialogTitle>
            <DialogDescription>
              {store.shopDomain} · {deleting?.namespace}.{deleting?.key}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 overflow-y-auto p-5">
            <p className="text-sm">
              By default, existing metafields and their values are kept without
              a definition.
            </p>
            <Field orientation="horizontal">
              <Checkbox
                checked={deleteValues}
                disabled={busy}
                id="delete-values"
                onCheckedChange={setDeleteValues}
              />
              <FieldLabel htmlFor="delete-values">
                Also delete all associated metafields and values. This cannot be
                undone.
              </FieldLabel>
            </Field>
            {deleteValues ? (
              <Field>
                <FieldLabel htmlFor="delete-confirmation">
                  Type {deleting?.namespace}.{deleting?.key} to confirm
                </FieldLabel>
                <Input
                  disabled={busy}
                  id="delete-confirmation"
                  onChange={(event) => setConfirmation(event.target.value)}
                  value={confirmation}
                />
              </Field>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
            <Button
              disabled={
                busy ||
                !canMutate ||
                (deleteValues &&
                  confirmation !== `${deleting?.namespace}.${deleting?.key}`)
              }
              onClick={() => {
                if (!deleting) {
                  return;
                }
                const current = deleting;
                run(async () => {
                  const data = await execute<{
                    metafieldDefinitionDelete: MutationPayload;
                  }>(store.id, DELETE, { deleteValues, id: current.id });
                  checkMutation(data.metafieldDefinitionDelete);
                  setDeleting(null);
                  setNotice(
                    deleteValues
                      ? "Definition deleted. Shopify will remove associated values asynchronously."
                      : "Definition deleted. Existing values were kept."
                  );
                });
              }}
              variant="destructive"
            >
              {busy ? "Deleting…" : "Delete definition"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BatchEditor({
  storeId,
  ownerType,
  types,
  busy,
  canMutate,
  run,
  onClose,
}: {
  storeId: string;
  ownerType: string;
  types: { name: string }[];
  busy: boolean;
  canMutate: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Draft[]>(() => [newDraft()]);
  const [error, setError] = useState("");
  const update = (id: string, patch: Partial<Draft>) =>
    setRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, ...patch, result: "" } : row
      )
    );
  const hasResults = rows.some((row) => Boolean(row.result));
  const pending = rows.filter((row) => !row.created);
  const create = () => {
    const validation = validateDrafts(rows);
    setError(validation ?? "");
    if (validation) {
      return;
    }
    run(async () => {
      for (const row of pending) {
        try {
          const data = await execute<{
            metafieldDefinitionCreate: MutationPayload;
          }>(storeId, CREATE, {
            definition: {
              description: row.description,
              key: row.key,
              name: row.name.trim(),
              namespace: row.namespace,
              ownerType,
              type: row.type,
              validations: referenceValidations(
                row.type,
                row.metaobjectIds ?? []
              ),
            },
          });
          checkMutation(data.metafieldDefinitionCreate);
          setRows((current) =>
            current.map((item) =>
              item.id === row.id
                ? { ...item, created: true, result: "Created" }
                : item
            )
          );
        } catch (failure) {
          setRows((current) =>
            current.map((item) =>
              item.id === row.id ? { ...item, result: message(failure) } : item
            )
          );
        }
      }
    });
  };
  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "Name",
                "Namespace",
                "Key",
                "Type",
                "Values",
                "Description",
                ...(hasResults ? ["Result"] : []),
              ].map((title) => (
                <TableHead className="p-2 font-medium" key={title}>
                  {title}
                </TableHead>
              ))}
              <TableHead className="w-10 p-2">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <Fragment key={row.id}>
                <TableRow>
                  {(["name", "namespace", "key"] as const).map((field) => (
                    <TableCell className="min-w-28 p-2" key={field}>
                      <Input
                        aria-label={`Row ${index + 1} ${field}`}
                        disabled={busy || row.created}
                        onChange={(event) =>
                          update(row.id, { [field]: event.target.value })
                        }
                        value={row[field]}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="min-w-48 p-2">
                    <TypePicker
                      disabled={busy || Boolean(row.created)}
                      onChange={(type) =>
                        update(row.id, { metaobjectIds: [], type })
                      }
                      rowNumber={index + 1}
                      types={types}
                      value={row.type}
                    />
                  </TableCell>
                  <TableCell className="w-36 min-w-36 p-2">
                    <ValueModePicker
                      disabled={busy || Boolean(row.created)}
                      onChange={(type) => update(row.id, { type })}
                      rowNumber={index + 1}
                      types={types}
                      value={row.type}
                    />
                  </TableCell>
                  <TableCell className="min-w-40 p-2">
                    <Input
                      aria-label={`Row ${index + 1} description`}
                      disabled={busy || row.created}
                      onChange={(event) =>
                        update(row.id, { description: event.target.value })
                      }
                      value={row.description}
                    />
                  </TableCell>
                  {hasResults ? (
                    <TableCell className="max-w-60 whitespace-normal p-2">
                      <span aria-live="polite" className="text-xs">
                        {row.result}
                      </span>
                    </TableCell>
                  ) : null}
                  <TableCell className="w-10 p-2">
                    {row.created ? null : (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              aria-label={`Remove row ${index + 1}`}
                              disabled={busy || rows.length === 1}
                              onClick={() =>
                                setRows((current) =>
                                  current.filter((item) => item.id !== row.id)
                                )
                              }
                              size="icon-sm"
                              variant="ghost"
                            />
                          }
                        >
                          <Trash2 />
                        </TooltipTrigger>
                        <TooltipContent>Remove row</TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
                {needsMetaobject(row.type) ? (
                  <TableRow>
                    <TableCell
                      className="px-3 py-3"
                      colSpan={hasResults ? 8 : 7}
                    >
                      <Field>
                        <FieldLabel>
                          Allowed metaobject definitions for row {index + 1}
                        </FieldLabel>
                        <MetaobjectPicker
                          disabled={busy || Boolean(row.created)}
                          ids={row.metaobjectIds ?? []}
                          onChange={(metaobjectIds) =>
                            update(row.id, { metaobjectIds })
                          }
                          rowId={row.id}
                          storeId={storeId}
                          type={row.type}
                        />
                      </Field>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          disabled={busy || rows.length >= 50}
          onClick={() => setRows((current) => [...current, newDraft()])}
          variant="outline"
        >
          Add row
        </Button>
        <span className="text-muted-foreground text-sm" role="status">
          {rows.filter((row) => row.created).length} / {rows.length} created
        </span>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={onClose} variant="outline">
            Close
          </Button>
          <Button
            disabled={busy || !canMutate || pending.length === 0}
            onClick={create}
          >
            {busy ? "Creating…" : `Create ${pending.length} definitions`}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The dark bar that floats over the table while rows are selected. */
function BulkBar({
  children,
  count,
  onClear,
}: {
  children: ReactNode;
  count: number;
  onClear: () => void;
}) {
  if (count === 0) {
    return null;
  }
  return (
    <div
      aria-label="Bulk actions"
      className="sticky bottom-6 z-10 mx-auto flex items-center gap-2.5 rounded-card bg-(--toast-bg) py-1.5 pr-1.5 pl-3.5 text-(--toast-fg) text-[13px] shadow-toast"
      role="toolbar"
    >
      <span className="font-[550] tabular-nums">{count} selected</span>
      <Button
        className="text-(--toast-muted) hover:bg-white/10 hover:text-(--toast-fg)"
        onClick={onClear}
        size="sm"
        variant="ghost"
      >
        Clear
      </Button>
      <span aria-hidden="true" className="h-[18px] w-px bg-white/15" />
      {children}
    </div>
  );
}

function DefinitionsTable({
  selectedIds,
  onSelectionChange,
  loading,
  error,
  visible,
  search,
  disabled,
  onEdit,
  onDelete,
}: {
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  loading: boolean;
  error: boolean;
  visible: Definition[];
  search: string;
  disabled: boolean;
  onEdit: (item: Definition) => void;
  onDelete: (item: Definition) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col" role="status">
        <span className="sr-only">Loading definitions…</span>
        {["w-2/5", "w-1/3", "w-1/2", "w-2/5"].map((width, index) => (
          <div
            className="flex h-11 items-center gap-3 border-border border-b"
            // biome-ignore lint/suspicious/noArrayIndexKey: Static placeholder rows.
            key={index}
          >
            <Skeleton className="size-4 rounded-[4.5px]" />
            <Skeleton className={`h-2.5 ${width}`} />
            <span className="flex-1" />
            <Skeleton className="h-5 w-28 rounded-[5px]" />
          </div>
        ))}
      </div>
    );
  }
  const allSelected =
    visible.length > 0 && visible.every((item) => selectedIds.has(item.id));
  return (
    <div className="-mx-3">
      <Table
        className="table-fixed"
        containerClassName="rounded-none shadow-none"
      >
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox
                aria-label="Select all visible definitions"
                checked={allSelected}
                disabled={disabled || !visible.length}
                indeterminate={
                  visible.some((item) => selectedIds.has(item.id)) &&
                  !allSelected
                }
                onCheckedChange={(checked) => {
                  const next = new Set(selectedIds);
                  for (const item of visible) {
                    if (checked) {
                      next.add(item.id);
                    } else {
                      next.delete(item.id);
                    }
                  }
                  onSelectionChange(next);
                }}
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-[32%]">Namespace and key</TableHead>
            <TableHead className="w-56">Type</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((item) => {
            const selected = selectedIds.has(item.id);
            return (
              <TableRow
                className={selected ? "bg-selected hover:bg-selected" : ""}
                data-state={selected ? "selected" : undefined}
                key={item.id}
              >
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${item.namespace}.${item.key}`}
                    checked={selected}
                    disabled={disabled}
                    onCheckedChange={(checked) => {
                      const next = new Set(selectedIds);
                      if (checked) {
                        next.add(item.id);
                      } else {
                        next.delete(item.id);
                      }
                      onSelectionChange(next);
                    }}
                  />
                </TableCell>
                <TableCell>
                  <div className="truncate font-[550]">{item.name}</div>
                  {item.description ? (
                    <p className="truncate text-muted-foreground text-xs">
                      {item.description}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="truncate text-xs tabular-nums">
                  {item.namespace}.{item.key}
                </TableCell>
                <TableCell>
                  <span
                    className="inline-flex h-5 max-w-full items-center truncate rounded-[5px] bg-hover px-1.5 text-[11px] text-foreground-2 tabular-nums"
                    title={typeLabel(item.type.name)}
                  >
                    {item.type.name}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          aria-label={`Actions for ${item.namespace}.${item.key}`}
                          disabled={disabled}
                          size="icon-sm"
                          variant="ghost"
                        />
                      }
                    >
                      <Ellipsis />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => onEdit(item)}>
                        <PencilLine />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onDelete(item)}
                        variant="destructive"
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {visible.length === 0 && !error ? (
        <p className="p-10 text-center text-[13px] text-muted-foreground">
          {search
            ? "No matching definitions."
            : "No definitions yet for this resource. Create your first batch."}
        </p>
      ) : null}
    </div>
  );
}

function Feedback({
  error,
  notice,
  typesError,
  definitionsError,
}: {
  error: string;
  notice: string;
  typesError: Error | null;
  definitionsError: Error | null;
}) {
  return (
    <>
      {error ? <ErrorAlert message={error} title="That didn't work." /> : null}
      {notice ? <InlineAlert tone="neutral">{notice}</InlineAlert> : null}
      {typesError ? (
        <ErrorAlert
          message={message(typesError)}
          title="Couldn't load field types."
        />
      ) : null}
      {definitionsError ? (
        <ErrorAlert
          message={message(definitionsError)}
          title="Couldn't load definitions."
        />
      ) : null}
    </>
  );
}
