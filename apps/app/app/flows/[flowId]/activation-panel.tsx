"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  ErrorAlert,
  InlineAlert,
  StatusBadge,
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
import { useCallback, useEffect, useState } from "react";
import type { Store } from "../../lib/queries";
import { StorePicker } from "./store-picker";

type Activation = Awaited<
  ReturnType<typeof apiClient.flows.activations.list>
>["data"][number];

const STATUS_LABELS: Record<Activation["status"], string> = {
  ACTIVE: "Active",
  FAILED: "Failed",
  INACTIVE: "Off",
};

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

  const selected = stores.find(({ id }) => id === storeId);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Activate this flow</DialogTitle>
          <DialogDescription>
            An activated flow starts by itself for that store. It runs the
            version saved when it was activated.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {hasUnsavedChanges ? (
            <InlineAlert tone="warning">
              Save your changes first; activation uses the saved version.
            </InlineAlert>
          ) : null}
          {error ? <ErrorAlert message={error} title="Not activated." /> : null}
          <div className="flex flex-col gap-2">
            <span className="font-medium text-[13px]">Activations</span>
            {activations.length > 0 ? (
              <ul
                aria-label="Activations"
                className="divide-y divide-border overflow-hidden rounded-menu border border-border"
              >
                {activations.map((activation) => (
                  <li
                    className="flex flex-col gap-1 px-3 py-2.5"
                    key={activation.id}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[13px]">
                        {activation.storeName}
                      </span>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={activation.status}>
                          {STATUS_LABELS[activation.status]}
                        </StatusBadge>
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
                            size="xs"
                            variant="outline"
                          >
                            Deactivate
                          </Button>
                        ) : null}
                        {canManage && activation.status !== "ACTIVE" ? (
                          <Button
                            disabled={isBusy || hasUnsavedChanges}
                            onClick={() => activate(activation.storeId)}
                            size="xs"
                            variant="outline"
                          >
                            Activate again
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {activation.error ? (
                      <p className="whitespace-pre-wrap break-words text-(--status-danger-fg) text-xs">
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
          </div>
          {canManage && stores.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="font-medium text-[13px]">Activate on</span>
              <StorePicker
                label="Store to activate on"
                onChange={setStoreId}
                storeId={storeId}
                stores={stores}
              />
            </div>
          ) : null}
          {selected?.environment === "PROD" ? (
            <InlineAlert title="Production store." tone="danger">
              Once active, this flow changes data on{" "}
              <span className="font-mono">{selected.shopDomain}</span> by
              itself.
            </InlineAlert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Close
          </Button>
          {canManage ? (
            <Button
              disabled={isBusy || hasUnsavedChanges || !storeId}
              onClick={() => activate(storeId)}
              variant={selected?.environment === "PROD" ? "danger" : "default"}
            >
              {isBusy ? "Working…" : `Activate on ${selected?.name ?? "store"}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
