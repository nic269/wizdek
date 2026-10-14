import { type Prisma, prisma } from "@repo/database";
import { encryptSecret } from "../crypto";
import { recordShopifyAudit } from "./audit";
import { StoreConnectionError } from "./errors";
import { createApp, findApp, type ShopifyAppRecord } from "./store-repository";

export interface AppScope {
  appId: string;
  organizationId: string;
}

export interface RegisterAppInput {
  actorId: string;
  clientId: string;
  clientSecret: string;
  installLink?: string | undefined;
  name: string;
  organizationId: string;
  scopes: string[];
  tokenMode?: ShopifyAppRecord["tokenMode"] | undefined;
}

export interface UpdateAppInput {
  actorId: string;
  /** Rotates the stored secret when provided. */
  clientSecret?: string | undefined;
  installLink?: string | null | undefined;
  name?: string | undefined;
  scopes?: string[] | undefined;
  tokenMode?: ShopifyAppRecord["tokenMode"] | undefined;
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

const requireApp = async (
  scope: AppScope,
  db: Prisma.TransactionClient
): Promise<ShopifyAppRecord> => {
  const app = await findApp(scope, db);
  if (!app) {
    throw new StoreConnectionError("APP_NOT_FOUND", "Shopify app not found.");
  }
  return app;
};

export const registerApp = async (
  input: RegisterAppInput
): Promise<ShopifyAppRecord> => {
  try {
    return await prisma.$transaction(async (transaction) => {
      const app = await createApp(
        { ...input, createdById: input.actorId },
        transaction
      );
      await recordShopifyAudit(transaction, {
        action: "shopify.app.created",
        actorId: input.actorId,
        metadata: { clientId: app.clientId, name: app.name },
        organizationId: app.organizationId,
        targetId: app.id,
        targetType: "ShopifyApp",
      });
      return app;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new StoreConnectionError(
        "APP_IN_USE",
        "An app with this client ID is already registered."
      );
    }
    throw error;
  }
};

export const updateApp = (
  scope: AppScope,
  input: UpdateAppInput
): Promise<ShopifyAppRecord> =>
  prisma.$transaction(async (transaction) => {
    await requireApp(scope, transaction);
    const secretRotated = input.clientSecret !== undefined;
    const app = await transaction.shopifyApp.update({
      data: {
        ...(input.clientSecret === undefined
          ? {}
          : { clientSecretEncrypted: encryptSecret(input.clientSecret) }),
        ...(input.installLink === undefined
          ? {}
          : { installLink: input.installLink }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
        ...(input.tokenMode === undefined
          ? {}
          : { tokenMode: input.tokenMode }),
      },
      where: { id: scope.appId },
    });
    if (secretRotated) {
      // Stores renew their tokens with this secret, so their last check no
      // longer says anything about whether they still work.
      await transaction.shopifyStore.updateMany({
        data: { lastHealthCheckAt: null },
        where: { appId: app.id },
      });
    }
    await recordShopifyAudit(transaction, {
      action: "shopify.app.updated",
      actorId: input.actorId,
      metadata: { name: app.name, secretRotated, tokenMode: app.tokenMode },
      organizationId: app.organizationId,
      targetId: app.id,
      targetType: "ShopifyApp",
    });
    return app;
  });

export const deleteApp = (scope: AppScope, actorId: string): Promise<void> =>
  prisma.$transaction(async (transaction) => {
    const app = await requireApp(scope, transaction);
    const storeCount = await transaction.shopifyStore.count({
      where: { appId: app.id },
    });
    if (storeCount > 0) {
      throw new StoreConnectionError(
        "APP_IN_USE",
        "Remove the stores connected through this app before deleting it.",
        { storeCount }
      );
    }
    await transaction.shopifyApp.delete({ where: { id: app.id } });
    await recordShopifyAudit(transaction, {
      action: "shopify.app.deleted",
      actorId,
      metadata: { clientId: app.clientId, name: app.name },
      organizationId: app.organizationId,
      targetId: app.id,
      targetType: "ShopifyApp",
    });
  });
