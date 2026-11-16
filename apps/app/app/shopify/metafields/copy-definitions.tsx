"use client";

import { Button, Copy } from "@repo/design-system";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { OptionSelect } from "../../lib/option-select";
import type { Store } from "../../lib/queries";
import {
  buildCopyInput,
  type CopyDefinition,
  defaultMappings,
  loadCopyDefinitions,
  referenceKeys,
} from "./copy-api";
import {
  CREATE,
  checkMutation,
  type Definition,
  execute,
  listDefinitions,
  type MutationPayload,
} from "./metafields-api";
import { listMetaobjects, type MetaobjectDefinition } from "./metaobject-api";
import { needsMetaobject } from "./metaobject-validation";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed.";
const identifier = (item: Definition) => `${item.namespace}.${item.key}`;

export function CopyDefinitions({
  source,
  stores,
  selected,
  ownerType,
  disabled,
  onBusy,
  onDark = false,
}: {
  /** Styles the trigger for the dark bulk-action bar. */
  onDark?: boolean;
  source: Store;
  stores: Store[];
  selected: Definition[];
  ownerType: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        className={
          onDark ? "text-(--toast-fg) hover:bg-white/10 hover:text-white" : ""
        }
        disabled={disabled || !selected.length}
        onClick={() => setOpen(true)}
        size={onDark ? "sm" : "default"}
        variant={onDark ? "ghost" : "outline"}
      >
        <Copy />
        Copy to store
      </Button>
      <Dialog
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
          }
        }}
        open={open}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Copy definitions to another store</DialogTitle>
            <DialogDescription>
              From {source.shopDomain}. Copies names, types, validations,
              access, enabled capabilities and pinning. Existing definitions are
              skipped; values and metaobject entries are not copied.
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <CopyForm
              disabled={disabled}
              onBusy={(value) => {
                setBusy(value);
                onBusy(value);
              }}
              ownerType={ownerType}
              selected={selected}
              source={source}
              stores={stores}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CopyForm({
  source,
  stores,
  selected,
  ownerType,
  disabled,
  onBusy,
}: {
  source: Store;
  stores: Store[];
  selected: Definition[];
  ownerType: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [targetId, setTargetId] = useState("");
  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <Field>
        <FieldLabel htmlFor="copy-target">Destination store</FieldLabel>
        <OptionSelect
          disabled={disabled}
          id="copy-target"
          onValueChange={setTargetId}
          options={stores
            .filter(
              (store) => store.id !== source.id && store.status === "CONNECTED"
            )
            .map((store) => ({
              label: `${store.name} · ${store.shopDomain} · ${store.environment}`,
              value: store.id,
            }))}
          placeholder="Choose destination"
          value={targetId || null}
        />
      </Field>
      {targetId ? (
        <CopyPreview
          disabled={disabled}
          key={targetId}
          onBusy={onBusy}
          ownerType={ownerType}
          selected={selected}
          source={source}
          targetId={targetId}
        />
      ) : null}
    </div>
  );
}

interface Preview {
  definitions: CopyDefinition[];
  existing: Definition[];
  metaError: string;
  sourceMeta: MetaobjectDefinition[];
  targetMeta: MetaobjectDefinition[];
}
async function loadPreview(
  sourceId: string,
  targetId: string,
  selected: Definition[],
  ownerType: string
): Promise<Preview> {
  const [definitions, existing] = await Promise.all([
    loadCopyDefinitions(
      sourceId,
      selected.map((item) => item.id)
    ),
    listDefinitions(targetId, ownerType),
  ]);
  let sourceMeta: MetaobjectDefinition[] = [];
  let targetMeta: MetaobjectDefinition[] = [];
  let metaError = "";
  if (definitions.some((item) => needsMetaobject(item.type.name))) {
    try {
      [sourceMeta, targetMeta] = await Promise.all([
        listMetaobjects(sourceId),
        listMetaobjects(targetId),
      ]);
    } catch (error) {
      metaError = errorText(error);
    }
  }
  return { definitions, existing, metaError, sourceMeta, targetMeta };
}

function plannedRows(data: Preview, mappings: Record<string, string>) {
  return data.definitions.map((definition) => {
    if (
      data.existing.some((item) => identifier(item) === identifier(definition))
    ) {
      return { definition, input: null, status: "Skip: already exists" };
    }
    try {
      return {
        definition,
        input: buildCopyInput(definition, mappings, data.targetMeta),
        status: "Ready to create",
      };
    } catch (error) {
      return { definition, input: null, status: errorText(error) };
    }
  });
}

function CopyPreview({
  source,
  targetId,
  selected,
  ownerType,
  disabled,
  onBusy,
}: {
  source: Store;
  targetId: string;
  selected: Definition[];
  ownerType: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryFn: () => loadPreview(source.id, targetId, selected, ownerType),
    queryKey: [
      "copy-metafields-preview",
      source.id,
      targetId,
      ownerType,
      selected.map((item) => item.id),
    ],
    refetchOnWindowFocus: false,
  });
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  if (query.isPending) {
    return <p role="status">Checking source and destination definitions…</p>;
  }
  if (query.error || !query.data) {
    return (
      <p role="alert">
        {query.error?.message ?? "Could not load preview."}{" "}
        <Button onClick={() => query.refetch()} variant="outline">
          Retry
        </Button>
      </p>
    );
  }
  const { data } = query;
  const mappings = {
    ...defaultMappings(data.sourceMeta, data.targetMeta),
    ...overrides,
  };
  const rows = plannedRows(data, mappings);
  const ready = rows.filter(
    (row) => row.input && !completed.has(row.definition.id)
  );
  const mappingKeys = [
    ...new Set(
      data.definitions.flatMap((item) => {
        try {
          return referenceKeys(item);
        } catch {
          return [];
        }
      })
    ),
  ];
  const copy = async () => {
    if (lock.current || disabled) {
      return;
    }
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      // Recheck duplicates immediately before writes, including after an uncertain response.
      const existing = new Set(
        (await listDefinitions(targetId, ownerType)).map(identifier)
      );
      for (const row of ready) {
        const { id } = row.definition;
        if (existing.has(identifier(row.definition))) {
          setResults((current) => ({
            ...current,
            [id]: "Skipped: already exists",
          }));
          setCompleted((current) => new Set([...current, id]));
          continue;
        }
        try {
          const result = await execute<{
            metafieldDefinitionCreate: MutationPayload;
          }>(targetId, CREATE, { definition: row.input });
          checkMutation(result.metafieldDefinitionCreate);
          existing.add(identifier(row.definition));
          setCompleted((current) => new Set([...current, id]));
          setResults((current) => ({ ...current, [id]: "Created" }));
        } catch (failure) {
          setResults((current) => ({ ...current, [id]: errorText(failure) }));
        }
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      await client.invalidateQueries({
        queryKey: ["metafield-definitions", source.organizationId, targetId],
      });
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <>
      {data.metaError ? (
        <p role="alert">
          Could not load metaobject definitions: {data.metaError}. Metaobject
          references cannot be copied until both stores allow
          read_metaobject_definitions.
        </p>
      ) : null}
      {mappingKeys.length ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Match allowed metaobject types in the destination. Matching types
            are preselected; missing types must be created in Shopify first.
          </p>
          {mappingKeys.map((key) => (
            <Field key={key}>
              <FieldLabel htmlFor={`mapping-${key}`}>
                {data.sourceMeta.find(
                  (item) => item.id === key || item.type === key
                )?.type ?? key}
              </FieldLabel>
              <OptionSelect
                disabled={busy || disabled}
                id={`mapping-${key}`}
                onValueChange={(value) =>
                  setOverrides((current) => ({ ...current, [key]: value }))
                }
                options={data.targetMeta.map((item) => ({
                  label: `${item.name} (${item.type})`,
                  value: item.id,
                }))}
                placeholder="Choose destination metaobject"
                value={mappings[key] ?? null}
              />
            </Field>
          ))}
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Definition</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.definition.id}>
              <TableCell>{identifier(row.definition)}</TableCell>
              <TableCell
                aria-live="polite"
                className="max-w-sm whitespace-normal"
              >
                {results[row.definition.id] ?? row.status}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {error ? <p role="alert">{error}</p> : null}
      <Button disabled={busy || disabled || !ready.length} onClick={copy}>
        {busy ? "Copying…" : `Copy ${ready.length} definitions`}
      </Button>
    </>
  );
}
