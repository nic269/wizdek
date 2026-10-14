"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  ErrorAlert,
  InlineAlert,
  Input,
  Play,
  toast,
} from "@repo/design-system";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { plural } from "../../lib/format";
import { type Store, useStores } from "../../lib/queries";
import { CategoryChip } from "../node-visuals";
import { StorePicker } from "./store-picker";

export interface RunInput {
  key: string;
  label: string;
  type: "file" | "text" | "number";
}

const LINE_BREAK = /\r?\n/;

/** Row count and header of a chosen CSV file, read in the browser. */
interface CsvPreview {
  columns: string[];
  file: File;
  rows: number;
}

const previewCsv = async (file: File): Promise<CsvPreview> => {
  const lines = (await file.text())
    .split(LINE_BREAK)
    .filter((line) => line.trim());
  return {
    columns: (lines[0] ?? "")
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean),
    file,
    rows: Math.max(0, lines.length - 1),
  };
};

const ENVIRONMENT_TITLES = {
  DEV: "Development store.",
  PROD: "Production store.",
  STAGING: "Staging store.",
} as const;

const FileInputRow = ({
  input,
  onChange,
  preview,
}: {
  input: RunInput;
  onChange: (preview: CsvPreview) => void;
  preview: CsvPreview | undefined;
}) => {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium text-[13px]">
        {input.label}{" "}
        <span className="font-normal text-muted-foreground">
          · trigger input
        </span>
      </span>
      <div className="flex items-center gap-2.5 rounded-menu border border-input border-dashed bg-sunken p-3">
        <CategoryChip category="data" nodeType="data.parseCsv" size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-[13px] leading-[1.3]">
            {preview?.file.name ?? "No file chosen"}
          </span>
          <span className="block truncate text-muted-foreground text-xs leading-[1.3]">
            {preview
              ? `${plural(preview.rows, "row")}${preview.columns.length ? ` · columns ${preview.columns.join(", ")}` : ""}`
              : "A CSV file, up to 10 MB."}
          </span>
        </span>
        <Button
          onClick={() => fileInput.current?.click()}
          size="xs"
          type="button"
          variant="outline"
        >
          {preview ? "Replace" : "Choose file"}
        </Button>
        <Input
          accept=".csv,text/csv"
          aria-label={input.label}
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) {
              onChange(await previewCsv(file));
            }
          }}
          ref={fileInput}
          tabIndex={-1}
          type="file"
        />
      </div>
    </div>
  );
};

const RiskCallout = ({
  actionLabels,
  maxItems,
  store,
}: {
  actionLabels: string[];
  maxItems: number | null;
  store: Store;
}) => {
  const prod = store.environment === "PROD";
  const writes =
    actionLabels.length === 0
      ? "No step in this flow changes data in"
      : `${actionLabels.join(", ")} ${actionLabels.length === 1 ? "writes" : "write"} to`;
  return (
    <InlineAlert
      className={prod ? undefined : "border-border bg-sunken text-foreground-2"}
      title={ENVIRONMENT_TITLES[store.environment]}
      tone={prod ? "danger" : "info"}
    >
      {writes} <span className="font-mono">{store.shopDomain}</span>.
      {maxItems !== null && actionLabels.length > 0
        ? ` Up to ${plural(maxItems, "item")} may be changed.`
        : ""}
    </InlineAlert>
  );
};

/**
 * Starts a run: pick the store, fill the trigger's inputs, and see what the
 * run may change. A file is uploaded first and the run receives its id.
 */
export function RunDialog({
  actionLabels,
  flowId,
  flowName,
  inputs,
  onOpenChange,
  open,
  organizationId,
  version,
}: {
  /** Labels of the steps that write to the store, for the risk callout. */
  actionLabels: string[];
  flowId: string;
  flowName: string;
  inputs: RunInput[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string;
  version: number;
}) {
  const router = useRouter();
  const stores = useStores(organizationId, open);
  const connected = (stores.data ?? []).filter(
    ({ status }) => status === "CONNECTED"
  );
  const [storeId, setStoreId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, CsvPreview>>({});
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      setIsStarting(false);
    }
  }, [open]);
  useEffect(() => {
    if (!(storeId || connected.length === 0)) {
      setStoreId(connected[0]?.id ?? "");
    }
  }, [connected, storeId]);

  const store = connected.find(({ id }) => id === storeId);
  const csvRows = Object.values(files).map(({ rows }) => rows);
  const maxItems = csvRows.length > 0 ? Math.max(...csvRows) : null;
  const missingInput = inputs.some((input) =>
    input.type === "file" ? !files[input.key] : !values[input.key]
  );

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!store) {
      return;
    }
    setError(null);
    setIsStarting(true);
    try {
      const runInputs: Record<string, unknown> = {};
      for (const input of inputs) {
        if (input.type === "file") {
          const preview = files[input.key];
          if (!preview) {
            throw new Error(`Choose a file for "${input.label}".`);
          }
          const uploaded = await apiClient.files.upload({
            file: preview.file,
            organizationId,
          });
          runInputs[input.key] = uploaded.data.id;
        } else {
          runInputs[input.key] = values[input.key] ?? "";
        }
      }
      const { data } = await apiClient.flows.runs.start({
        flowId,
        inputs: runInputs,
        storeId: store.id,
      });
      toast.loading(`Run #${data.number} started`, {
        description: `${store.name} · queued`,
        duration: 4000,
      });
      router.push(`/flows/${flowId}/runs/${data.id}`);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not start the run."));
      setIsStarting(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="top-[10vh] translate-y-0 sm:max-w-[520px]">
        <form className="flex min-h-0 flex-col" onSubmit={start}>
          <DialogHeader>
            <DialogTitle>Run “{flowName}”</DialogTitle>
            <DialogDescription>
              Version {version} · manual trigger
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-2">
              <span className="font-medium text-[13px]">Store</span>
              {stores.isPending ? (
                <p className="text-muted-foreground text-sm">Loading stores…</p>
              ) : null}
              {stores.isSuccess && connected.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No store is connected.{" "}
                  <Link
                    className="text-accent-ink underline"
                    href="/stores/new"
                  >
                    Connect a store
                  </Link>{" "}
                  first.
                </p>
              ) : (
                <StorePicker
                  label="Store to run against"
                  onChange={setStoreId}
                  storeId={storeId}
                  stores={connected}
                />
              )}
            </div>
            {inputs.map((input) =>
              input.type === "file" ? (
                <FileInputRow
                  input={input}
                  key={input.key}
                  onChange={(preview) =>
                    setFiles((current) => ({
                      ...current,
                      [input.key]: preview,
                    }))
                  }
                  preview={files[input.key]}
                />
              ) : (
                <Field className="gap-2" key={input.key}>
                  <FieldLabel htmlFor={`run-input-${input.key}`}>
                    {input.label}{" "}
                    <span className="font-normal text-muted-foreground">
                      · trigger input
                    </span>
                  </FieldLabel>
                  <Input
                    id={`run-input-${input.key}`}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [input.key]: event.target.value,
                      }))
                    }
                    required
                    type={input.type === "number" ? "number" : "text"}
                    value={values[input.key] ?? ""}
                  />
                </Field>
              )
            )}
            {store ? (
              <RiskCallout
                actionLabels={actionLabels}
                maxItems={maxItems}
                store={store}
              />
            ) : null}
            {error ? <ErrorAlert message={error} title="Not started." /> : null}
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={isStarting || !store || missingInput}
              type="submit"
              variant={store?.environment === "PROD" ? "danger" : "default"}
            >
              <Play className="size-[13px]" />
              {isStarting ? "Starting…" : `Run on ${store?.name ?? "store"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
