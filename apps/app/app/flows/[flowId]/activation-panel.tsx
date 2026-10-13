"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { Button, ErrorState } from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { useCallback, useEffect, useState } from "react";
import type { Store } from "../../stores/store-labels";

type Activation = Awaited<
  ReturnType<typeof apiClient.flows.activations.list>
>["data"][number];

const STATUS_LABELS: Record<Activation["status"], string> = {
  ACTIVE: "Active",
  FAILED: "Failed",
  INACTIVE: "Off",
};

const STATUS_VARIANTS: Record<
  Activation["status"],
  "default" | "destructive" | "outline"
> = {
  ACTIVE: "default",
  FAILED: "destructive",
  INACTIVE: "outline",
};

const selectClassName =
  "h-10 w-full rounded-md border bg-background px-3 text-sm";

/**
 * Turns a webhook or scheduled flow on and off per store. An activation uses
 * the version saved at that moment; activate again after saving changes.
 */
export function ActivationPanel({
  canManage,
  flowId,
  hasUnsavedChanges,
  onOpenChange,
  open,
  organizationId,
}: {
  canManage: boolean;
  flowId: string;
  hasUnsavedChanges: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string;
}) {
  const [activations, setActivations] = useState<Activation[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    const [activationList, storeList] = await Promise.all([
      apiClient.flows.activations.list({ flowId }),
      apiClient.shopifyStores.list({ organizationId }),
    ]);
    const connected = storeList.data.filter(
      ({ status }) => status === "CONNECTED"
    );
    setActivations(activationList.data);
    setStores(connected);
    setStoreId((current) => current || (connected[0]?.id ?? ""));
  }, [flowId, organizationId]);

  useEffect(() => {
    if (open) {
      setError(null);
      load().catch((cause: unknown) =>
        setError(getApiErrorMessage(cause, "Could not load activations."))
      );
    }
  }, [load, open]);

  const attempt = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    setIsBusy(true);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, fallback));
    } finally {
      setIsBusy(false);
    }
  };

  const activate = (targetStoreId: string) =>
    attempt(
      () =>
        apiClient.flows.activations.activate({
          flowId,
          storeId: targetStoreId,
        }),
      "Could not activate the flow."
    );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Activate this flow</DialogTitle>
          <DialogDescription>
            An activated flow starts by itself for that store. It runs the
            version saved when it was activated.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {hasUnsavedChanges ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              Save your changes first; activation uses the saved version.
            </p>
          ) : null}
          {error ? <ErrorState message={error} title="Not activated" /> : null}
          {activations.length > 0 ? (
            <ul
              aria-label="Activations"
              className="divide-y rounded-md border text-sm"
            >
              {activations.map((activation) => (
                <li className="space-y-1 px-3 py-2" key={activation.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{activation.storeName}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANTS[activation.status]}>
                        {STATUS_LABELS[activation.status]}
                      </Badge>
                      {canManage && activation.status === "ACTIVE" ? (
                        <Button
                          disabled={isBusy}
                          onClick={() =>
                            attempt(
                              () =>
                                apiClient.flows.activations.deactivate({
                                  flowId,
                                  storeId: activation.storeId,
                                }),
                              "Could not deactivate the flow."
                            )
                          }
                          size="sm"
                          variant="outline"
                        >
                          Deactivate
                        </Button>
                      ) : null}
                      {canManage && activation.status !== "ACTIVE" ? (
                        <Button
                          disabled={isBusy || hasUnsavedChanges}
                          onClick={() => activate(activation.storeId)}
                          size="sm"
                          variant="outline"
                        >
                          Activate again
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {activation.error ? (
                    <p className="whitespace-pre-wrap break-words text-destructive text-xs">
                      {activation.error}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              Not activated on any store yet.
            </p>
          )}
          {canManage ? (
            <div className="flex gap-2">
              <select
                aria-label="Store to activate on"
                className={selectClassName}
                onChange={(event) => setStoreId(event.target.value)}
                value={storeId}
              >
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} ({store.shopDomain})
                  </option>
                ))}
              </select>
              <Button
                disabled={isBusy || hasUnsavedChanges || !storeId}
                onClick={() => activate(storeId)}
              >
                {isBusy ? "Working..." : "Activate"}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
