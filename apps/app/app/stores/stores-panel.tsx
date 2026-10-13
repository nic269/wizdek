"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  buttonVariants,
  EmptyState,
  ErrorState,
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
import { useCallback, useEffect, useState } from "react";
import { useActiveOrganization } from "../lib/active-organization";
import {
  formatDateTime,
  STATUS_LABELS,
  STRATEGY_LABELS,
  type Store,
} from "./store-labels";

const STATUS_VARIANTS: Record<
  Store["status"],
  "default" | "destructive" | "outline" | "secondary"
> = {
  CONNECTED: "default",
  DISCONNECTED: "outline",
  PENDING: "secondary",
  RECONNECT_REQUIRED: "destructive",
};

export function StoresPanel() {
  const {
    error: organizationError,
    isLoading,
    organization,
  } = useActiveOrganization();
  const [stores, setStores] = useState<Store[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyStoreId, setBusyStoreId] = useState<string | null>(null);
  const [confirmingStoreId, setConfirmingStoreId] = useState<string | null>(
    null
  );
  const organizationId = organization?.id;

  const loadStores = useCallback(async () => {
    if (!organizationId) {
      return;
    }
    const { data } = await apiClient.shopifyStores.list({ organizationId });
    setStores(data);
  }, [organizationId]);

  useEffect(() => {
    setStores(null);
    setError(null);
    loadStores().catch((cause: unknown) =>
      setError(getApiErrorMessage(cause, "Could not load stores."))
    );
  }, [loadStores]);

  const runAction = async (
    storeId: string,
    action: () => Promise<{ data: { store: Store } | Store }>,
    fallback: string
  ) => {
    setError(null);
    setBusyStoreId(storeId);
    try {
      const { data } = await action();
      const updated = "store" in data ? data.store : data;
      setStores(
        (current) =>
          current?.map((store) =>
            store.id === updated.id ? updated : store
          ) ?? null
      );
    } catch (cause) {
      setError(getApiErrorMessage(cause, fallback));
    } finally {
      setBusyStoreId(null);
      setConfirmingStoreId(null);
    }
  };

  if (organizationError) {
    return <ErrorState message={organizationError} />;
  }
  if (!(isLoading || organization)) {
    return (
      <EmptyState
        description="Create an organization on the dashboard before connecting stores."
        title="No organization"
      />
    );
  }
  if (stores === null && !error) {
    return <LoadingState label="Loading stores" />;
  }

  return (
    <div className="space-y-4">
      {error ? <ErrorState message={error} /> : null}
      {stores?.length === 0 ? (
        <EmptyState
          description="Connect a store with an access token, an app install, or app credentials."
          title="No stores connected"
        />
      ) : null}
      {stores && stores.length > 0 ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((store) => {
                const isBusy = busyStoreId === store.id;
                return (
                  <TableRow
                    data-testid={`store-${store.shopDomain}`}
                    key={store.id}
                  >
                    <TableCell>
                      <div className="font-medium">{store.name}</div>
                      <div
                        className="max-w-56 truncate text-muted-foreground text-xs"
                        title={store.shopDomain}
                      >
                        {store.shopDomain}
                      </div>
                    </TableCell>
                    <TableCell>{STRATEGY_LABELS[store.strategy]}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[store.status]}>
                        {STATUS_LABELS[store.status]}
                      </Badge>
                      <p className="mt-1 text-muted-foreground text-xs">
                        Last checked: {formatDateTime(store.lastHealthCheckAt)}
                      </p>
                      {store.lastHealthCheckError ? (
                        <p className="mt-1 max-w-xs whitespace-normal text-destructive text-xs">
                          {store.lastHealthCheckError}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell title={store.scopes.join(", ")}>
                      {store.scopes.length === 0
                        ? "None recorded"
                        : `${store.scopes.length} granted`}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {confirmingStoreId === store.id ? (
                          <>
                            <Button
                              disabled={isBusy}
                              onClick={() =>
                                runAction(
                                  store.id,
                                  () =>
                                    apiClient.shopifyStores.disconnect({
                                      storeId: store.id,
                                    }),
                                  "Could not disconnect the store."
                                )
                              }
                              size="sm"
                              variant="destructive"
                            >
                              Confirm disconnect
                            </Button>
                            <Button
                              onClick={() => setConfirmingStoreId(null)}
                              size="sm"
                              variant="ghost"
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              disabled={
                                isBusy || store.status === "DISCONNECTED"
                              }
                              onClick={() =>
                                runAction(
                                  store.id,
                                  () =>
                                    apiClient.shopifyStores.checkHealth({
                                      storeId: store.id,
                                    }),
                                  "Could not check the store."
                                )
                              }
                              size="sm"
                              variant="outline"
                            >
                              {isBusy ? "Checking..." : "Check health"}
                            </Button>
                            <a
                              className={buttonVariants({
                                size: "sm",
                                variant: "outline",
                              })}
                              href={`/stores/new?shop=${encodeURIComponent(
                                store.shopDomain
                              )}`}
                            >
                              Reconnect
                            </a>
                            <Button
                              disabled={store.status === "DISCONNECTED"}
                              onClick={() => setConfirmingStoreId(store.id)}
                              size="sm"
                              variant="ghost"
                            >
                              Disconnect
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
