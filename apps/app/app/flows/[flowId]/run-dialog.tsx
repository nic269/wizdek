"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  ErrorAlert,
  Input,
  Play,
  TriangleAlert,
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
import { useStores } from "../../lib/queries";
import { CategoryChip } from "../node-visuals";
import { StoreMultiPicker } from "./store-multi-picker";

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

/** Starts one run per selected store with shared trigger inputs. */
export function RunDialog({
  flowId,
  flowName,
  inputs,
  onOpenChange,
  open,
  organizationId,
  version,
}: {
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
  const [storeIds, setStoreIds] = useState<string[] | null>(null);
  const starting = useRef(false);
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
  const selectedIds = storeIds ?? connected.slice(0, 1).map(({ id }) => id);
  const selectedStores = connected.filter(({ id }) => selectedIds.includes(id));
  const liveStores = selectedStores.filter(
    (store) => store.environment === "PROD"
  );
  const missingInput = inputs.some((input) =>
    input.type === "file" ? !files[input.key] : !values[input.key]
  );

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (starting.current || selectedStores.length === 0) {
      return;
    }
    starting.current = true;
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
      const results = await Promise.allSettled(
        selectedStores.map((store) =>
          apiClient.flows.runs.start({
            flowId,
            inputs: runInputs,
            storeId: store.id,
          })
        )
      );
      const failed = selectedStores.filter(
        (_, index) => results[index]?.status === "rejected"
      );
      const succeeded = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.data] : []
      );
      if (succeeded.length > 0) {
        toast.success(`${plural(succeeded.length, "run")} queued`);
      }
      if (failed.length > 0) {
        setStoreIds(failed.map(({ id }) => id));
        setError(
          `${results
            .flatMap((result, index) =>
              result.status === "rejected"
                ? [
                    `${selectedStores[index]?.name}: ${getApiErrorMessage(result.reason, "Could not start the run.")}`,
                  ]
                : []
            )
            .join(" ")} Only failed stores remain selected.`
        );
        return;
      }
      onOpenChange(false);
      router.push(
        succeeded.length === 1
          ? `/flows/${flowId}/runs/${succeeded[0]?.id}`
          : `/flows/${flowId}/runs`
      );
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not start the run."));
    } finally {
      starting.current = false;
      setIsStarting(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!starting.current) {
          onOpenChange(nextOpen);
        }
      }}
      open={open}
    >
      <DialogContent className="top-[10vh] translate-y-0 sm:max-w-[600px]">
        <form className="flex min-h-0 flex-col" onSubmit={start}>
          <DialogHeader>
            <DialogTitle>Run “{flowName}”</DialogTitle>
            <DialogDescription>
              Runs saved version{" "}
              <span className="tabular-nums">v{version}</span>. One run starts
              per store, in parallel.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-2">
              <div className="flex min-h-7 items-center gap-2">
                <span className="flex-1 font-medium text-[12.5px] text-foreground-2">
                  Stores
                </span>
                {connected.length > 1 ? (
                  <Button
                    disabled={isStarting}
                    onClick={() => setStoreIds(connected.map(({ id }) => id))}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Select all connected
                  </Button>
                ) : null}
              </div>
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
                <StoreMultiPicker
                  disabled={isStarting}
                  label="Store to run against"
                  onChange={setStoreIds}
                  storeIds={selectedIds}
                  stores={connected}
                />
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              Each selected store gets its own run with the same inputs. Runs
              for the same store are queued in order.
            </p>
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
            {liveStores.length > 0 ? (
              <div className="flex gap-2.5 rounded-[10px] bg-(--alert-warning-bg) px-3.5 py-3 text-(--alert-warning-fg) text-[13px] shadow-[inset_0_0_0_1px_var(--alert-warning-border)]">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong className="font-semibold">
                    {plural(liveStores.length, "run")} on live stores.
                  </strong>{" "}
                  The flow writes to{" "}
                  {liveStores.map((store) => store.name).join(", ")}.
                </span>
              </div>
            ) : null}
            {error ? (
              <ErrorAlert message={error} title="Could not start all runs." />
            ) : null}
          </DialogBody>
          <DialogFooter className="sm:items-center">
            <span className="flex-1 text-[11.5px] text-faint tabular-nums">
              {plural(selectedStores.length, "store")} selected
            </span>
            <Button
              disabled={isStarting}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={
                isStarting || selectedStores.length === 0 || missingInput
              }
              type="submit"
            >
              <Play className="size-[13px]" />
              {isStarting
                ? "Starting…"
                : `Start ${plural(selectedStores.length, "run")}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
