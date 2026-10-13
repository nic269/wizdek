import type { apiClient } from "@repo/api/client";

export type Store = Awaited<
  ReturnType<typeof apiClient.shopifyStores.list>
>["data"][number];

export type ShopifyApp = Awaited<
  ReturnType<typeof apiClient.shopifyApps.list>
>["data"][number];

export const STRATEGY_LABELS: Record<Store["strategy"], string> = {
  CLIENT_CREDENTIALS: "Client credentials",
  OAUTH: "OAuth install",
  STATIC_TOKEN: "Access token",
};

export const STATUS_LABELS: Record<Store["status"], string> = {
  CONNECTED: "Connected",
  DISCONNECTED: "Disconnected",
  PENDING: "Pending install",
  RECONNECT_REQUIRED: "Reconnect required",
};

export const formatDateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "never";
