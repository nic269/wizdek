import { prisma } from "@repo/database";
import {
  deleteApp,
  listApps,
  registerApp,
  type ShopifyAppRecord,
  updateApp,
} from "@repo/shopify/stores";
import { requireOrganizationAccess } from "./authz";
import { os } from "./implementer";
import { withShopifyErrors } from "./shopify-errors";

const toPublicApp = (app: ShopifyAppRecord, storeCount: number) => ({
  clientId: app.clientId,
  createdAt: app.createdAt,
  hasClientSecret: true as const,
  id: app.id,
  installLink: app.installLink,
  name: app.name,
  organizationId: app.organizationId,
  scopes: app.scopes,
  storeCount,
  tokenMode: app.tokenMode,
  updatedAt: app.updatedAt,
});

const countStores = (appId: string) =>
  prisma.shopifyStore.count({ where: { appId } });

const requireManager = (headers: Headers, organizationId: string) =>
  requireOrganizationAccess(headers, organizationId, "stores", "manage");

export const shopifyAppsRouter = {
  create: os.shopifyApps.create.handler(async ({ context, input }) => {
    const user = await requireManager(context.headers, input.organizationId);
    const app = await withShopifyErrors(() =>
      registerApp({ ...input, actorId: user.id })
    );
    return { data: toPublicApp(app, 0) };
  }),
  delete: os.shopifyApps.delete.handler(async ({ context, input }) => {
    const user = await requireManager(context.headers, input.organizationId);
    await withShopifyErrors(() => deleteApp(input, user.id));
  }),
  list: os.shopifyApps.list.handler(async ({ context, input }) => {
    await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "stores",
      "read"
    );
    const [apps, counts] = await Promise.all([
      listApps(input.organizationId),
      prisma.shopifyStore.groupBy({
        _count: { _all: true },
        by: ["appId"],
        where: { appId: { not: null }, organizationId: input.organizationId },
      }),
    ]);
    const storeCounts = new Map(
      counts.map(({ _count, appId }) => [appId, _count._all])
    );
    return {
      data: apps.map((app) => toPublicApp(app, storeCounts.get(app.id) ?? 0)),
    };
  }),
  update: os.shopifyApps.update.handler(async ({ context, input }) => {
    const user = await requireManager(context.headers, input.organizationId);
    const { appId, organizationId, ...changes } = input;
    const app = await withShopifyErrors(() =>
      updateApp({ appId, organizationId }, { ...changes, actorId: user.id })
    );
    return { data: toPublicApp(app, await countStores(app.id)) };
  }),
};
