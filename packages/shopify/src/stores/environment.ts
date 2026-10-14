import { prisma } from "@repo/database";
import { recordShopifyAudit } from "./audit";
import { type StoreScope, updateStore } from "./store-repository";

export type StoreEnvironment = "PROD" | "STAGING" | "DEV";

/**
 * Marks a store as production, staging or development. The environment is a
 * risk signal in the UI: writes against PROD ask for confirmation.
 */
export const setStoreEnvironment = (
  scope: StoreScope,
  environment: StoreEnvironment,
  actorId: string
) =>
  prisma.$transaction(async (transaction) => {
    await updateStore(scope, { environment }, transaction);
    await recordShopifyAudit(transaction, {
      action: "shopify.store.environment_changed",
      actorId,
      metadata: { environment },
      organizationId: scope.organizationId,
      targetId: scope.storeId,
      targetType: "ShopifyStore",
    });
  });
