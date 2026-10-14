"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { Button, ErrorState, Input } from "@repo/design-system";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { OptionSelect } from "../../lib/option-select";
import type { Store } from "../../stores/store-labels";

export interface RunInput {
  key: string;
  label: string;
  type: "file" | "text" | "number";
}

/**
 * Starts a run: pick the store it runs against and fill the trigger's
 * inputs. A file is uploaded first and the run receives its id.
 */
export function RunDialog({
  flowId,
  inputs,
  onOpenChange,
  open,
  organizationId,
}: {
  flowId: string;
  inputs: RunInput[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string;
}) {
  const router = useRouter();
  const [stores, setStores] = useState<Store[] | null>(null);
  const [storeId, setStoreId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    apiClient.shopifyStores
      .list({ organizationId })
      .then(({ data }) => {
        const connected = data.filter(({ status }) => status === "CONNECTED");
        setStores(connected);
        setStoreId((current) => current || (connected[0]?.id ?? ""));
      })
      .catch((cause: unknown) =>
        setError(getApiErrorMessage(cause, "Could not load stores."))
      );
  }, [open, organizationId]);

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsStarting(true);
    try {
      const runInputs: Record<string, unknown> = {};
      for (const input of inputs) {
        if (input.type === "file") {
          const file = files[input.key];
          if (!file) {
            throw new Error(`Choose a file for "${input.label}".`);
          }
          const uploaded = await apiClient.files.upload({
            file,
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
        storeId,
      });
      router.push(`/flows/${flowId}/runs/${data.id}`);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not start the run."));
      setIsStarting(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run this flow</DialogTitle>
          <DialogDescription>
            The run uses the saved version of the flow and changes data in the
            store you choose.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={start}>
          <div className="space-y-1">
            <p className="font-medium text-sm">Store</p>
            {stores?.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No store is connected.{" "}
                <a className="underline" href="/stores/new">
                  Connect a store
                </a>{" "}
                first.
              </p>
            ) : (
              <OptionSelect
                aria-label="Store to run against"
                onValueChange={setStoreId}
                options={(stores ?? []).map((store) => ({
                  label: `${store.name} (${store.shopDomain})`,
                  value: store.id,
                }))}
                placeholder="Choose a store"
                value={storeId || null}
              />
            )}
          </div>
          {inputs.map((input) => (
            <div className="space-y-1" key={input.key}>
              <p className="font-medium text-sm">{input.label}</p>
              {input.type === "file" ? (
                <Input
                  accept=".csv,text/csv"
                  aria-label={input.label}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setFiles((current) => ({
                        ...current,
                        [input.key]: file,
                      }));
                    }
                  }}
                  required
                  type="file"
                />
              ) : (
                <Input
                  aria-label={input.label}
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
              )}
            </div>
          ))}
          {error ? <ErrorState message={error} title="Not started" /> : null}
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isStarting || !storeId} type="submit">
              {isStarting ? "Starting..." : "Start run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
