import type { Prisma } from "@repo/database";
import type { DbClient } from "./store-repository";

export type ShopifyAuditAction =
  | "shopify.app.created"
  | "shopify.app.updated"
  | "shopify.app.deleted"
  | "shopify.store.connected"
  | "shopify.store.oauth_started"
  | "shopify.store.disconnected"
  | "shopify.store.environment_changed"
  | "shopify.store.renamed"
  | "shopify.store.credentials_updated"
  | "shopify.store.secret_revealed"
  | "shopify.graphql.query"
  | "shopify.graphql.mutation";

/**
 * Records a connection event. Metadata must never include a token or secret;
 * callers pass identifiers and non-sensitive attributes only.
 */
export const recordShopifyAudit = (
  db: DbClient,
  event: {
    action: ShopifyAuditAction;
    actorId: string;
    metadata?: Prisma.InputJsonObject;
    organizationId: string;
    targetId: string;
    targetType: "ShopifyApp" | "ShopifyStore";
  }
) =>
  db.auditLog.create({
    data: {
      action: event.action,
      actorId: event.actorId,
      organizationId: event.organizationId,
      targetId: event.targetId,
      targetType: event.targetType,
      ...(event.metadata ? { metadata: event.metadata } : {}),
    },
  });
