import { Box, KeyRound, ShieldCheck } from "@repo/design-system";
import type { ReactNode } from "react";
import type { Store } from "../lib/queries";

export type { ShopifyApp, Store } from "../lib/queries";

export const STRATEGY_LABELS: Record<Store["strategy"], string> = {
  CLIENT_CREDENTIALS: "App credentials",
  OAUTH: "OAuth",
  STATIC_TOKEN: "Access token",
};

export const STRATEGY_ICONS: Record<Store["strategy"], ReactNode> = {
  CLIENT_CREDENTIALS: <Box />,
  OAUTH: <ShieldCheck />,
  STATIC_TOKEN: <KeyRound />,
};

/** A store needs attention when it is not connected or misses its webhook secret. */
export const needsAttention = (store: Store) =>
  store.status === "RECONNECT_REQUIRED" ||
  store.status === "PENDING" ||
  (store.status === "CONNECTED" &&
    store.strategy === "STATIC_TOKEN" &&
    !store.hasWebhookSecret);

/** Stores connected by a pasted token sign webhooks with their own secret. */
export const usesOwnWebhookSecret = (store: Store) =>
  store.strategy === "STATIC_TOKEN";

export const isWriteScope = (scope: string) => scope.startsWith("write_");
