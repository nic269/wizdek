import { type Prisma, prisma } from "@repo/database";
import type { JobQueueProvider } from "@repo/jobs";
import { decryptSecret, webhookBaseUrl } from "@repo/shopify";
import { createStoreClient } from "@repo/shopify/stores";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  matchesWebhookTopic,
  verifyShopifyWebhookHmac,
} from "@repo/shopify/webhooks";
import type { FlowNode } from "../definition/schema";
import { FLOW_SCHEDULE_JOB } from "../engine/schedule-job";
import { builtInRegistry } from "../nodes";
import type { NodeRegistry } from "../registry/registry";
import { FlowServiceError } from "./errors";
import {
  type FlowScope,
  getFlow,
  readDefinition,
  validateDefinition,
} from "./flows";
import { startTriggeredRun } from "./runs";

export type FlowActivationRecord = Prisma.FlowActivationGetPayload<object>;

export interface ActivationDependencies {
  createStoreClient?: typeof createStoreClient;
  jobs: JobQueueProvider;
  registry?: NodeRegistry;
}

export const WEBHOOK_TRIGGER = "trigger.webhook";
export const SCHEDULE_TRIGGER = "trigger.schedule";
export const WEBHOOK_PATH_PREFIX = "/api/webhooks/shopify";
export const MAX_WEBHOOK_BYTES = 5_000_000;

const MAX_ERROR_LENGTH = 1000;

const invalid = (message: string) =>
  new FlowServiceError("ACTIVATION_INVALID", message);

const describe = (error: unknown) =>
  (error instanceof Error ? error.message : "Unknown error").slice(
    0,
    MAX_ERROR_LENGTH
  );

type StoreWithApp = Prisma.ShopifyStoreGetPayload<{ include: { app: true } }>;

/**
 * The secret Shopify signs this store's webhooks with: the app's client
 * secret for stores connected through an app, or the secret saved on a store
 * connected by a pasted token.
 */
const signingSecret = (store: StoreWithApp): string | undefined => {
  if (store.app) {
    return decryptSecret(store.app.clientSecretEncrypted);
  }
  return store.webhookSecretEncrypted
    ? decryptSecret(store.webhookSecretEncrypted)
    : undefined;
};

const triggerOf = (
  nodes: FlowNode[],
  registry: NodeRegistry
): FlowNode | undefined =>
  nodes.find((node) => registry.get(node.type)?.category === "trigger");

export const listActivations = (scope: FlowScope) =>
  prisma.flowActivation.findMany({
    include: { store: { select: { name: true, shopDomain: true } } },
    orderBy: { createdAt: "asc" },
    where: {
      flow: { id: scope.flowId, organizationId: scope.organizationId },
    },
  });

/** Removes whatever the activation set up outside this database. */
const tearDown = async (
  activation: FlowActivationRecord,
  organizationId: string,
  dependencies: ActivationDependencies
): Promise<void> => {
  if (activation.webhookSubscriptionId) {
    const client = await (dependencies.createStoreClient ?? createStoreClient)({
      organizationId,
      storeId: activation.storeId,
    });
    await deleteWebhookSubscription(client, activation.webhookSubscriptionId);
  }
  // Removing a schedule that does not exist is harmless.
  await dependencies.jobs
    .unschedule(FLOW_SCHEDULE_JOB, activation.id)
    .catch(() => undefined);
};

/**
 * Turns a flow on for one store. A webhook flow gets a subscription in
 * Shopify; a scheduled flow gets a schedule. When Shopify or the scheduler
 * refuses, the activation is kept as FAILED with the reason, so the person
 * can see what to fix. Activating again replaces the previous setup.
 */
export const activateFlow = async (
  scope: FlowScope,
  input: { actorId: string; storeId: string },
  dependencies: ActivationDependencies
): Promise<FlowActivationRecord> => {
  const registry = dependencies.registry ?? builtInRegistry;
  const { version } = await getFlow(scope);
  if (!version) {
    throw invalid("The flow has no saved version.");
  }
  const definition = readDefinition(version);
  const validation = validateDefinition(definition, registry);
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_INVALID",
      "The flow has problems that must be fixed before it can be activated.",
      validation.issues
    );
  }
  const trigger = triggerOf(definition.nodes, registry);
  if (trigger?.type !== WEBHOOK_TRIGGER && trigger?.type !== SCHEDULE_TRIGGER) {
    throw invalid(
      "Only flows that start from a webhook or a schedule can be activated."
    );
  }
  const store = await prisma.shopifyStore.findFirst({
    include: { app: true },
    where: { id: input.storeId, organizationId: scope.organizationId },
  });
  if (store?.status !== "CONNECTED") {
    throw new FlowServiceError(
      "STORE_NOT_AVAILABLE",
      store ? "The store is not connected." : "Store not found."
    );
  }
  const baseUrl = webhookBaseUrl();
  if (trigger.type === WEBHOOK_TRIGGER) {
    if (!baseUrl) {
      throw invalid(
        "Webhook flows need SHOPIFY_WEBHOOK_BASE_URL, a public address Shopify can reach."
      );
    }
    if (!signingSecret(store)) {
      throw invalid(
        "Save this store's webhook signing secret before activating a webhook flow on it."
      );
    }
  }

  const key = { flowId_storeId: { flowId: scope.flowId, storeId: store.id } };
  const existing = await prisma.flowActivation.findUnique({ where: key });
  if (existing) {
    await tearDown(existing, scope.organizationId, dependencies).catch(
      () => undefined
    );
  }
  const activation = await prisma.flowActivation.upsert({
    create: {
      activatedById: input.actorId,
      flowId: scope.flowId,
      flowVersionId: version.id,
      status: "INACTIVE",
      storeId: store.id,
    },
    update: {
      activatedById: input.actorId,
      error: null,
      flowVersionId: version.id,
      status: "INACTIVE",
      webhookSubscriptionId: null,
    },
    where: key,
  });

  try {
    let webhookSubscriptionId: string | null = null;
    if (trigger.type === WEBHOOK_TRIGGER) {
      const client = await (
        dependencies.createStoreClient ?? createStoreClient
      )({ organizationId: scope.organizationId, storeId: store.id });
      webhookSubscriptionId = await createWebhookSubscription(client, {
        topic: String(trigger.config.topic),
        uri: `${baseUrl}${WEBHOOK_PATH_PREFIX}/${activation.id}`,
      });
    } else {
      await dependencies.jobs.schedule({
        cron: String(trigger.config.cron),
        key: activation.id,
        name: FLOW_SCHEDULE_JOB,
        payload: { activationId: activation.id },
        timezone: String(trigger.config.timezone ?? "UTC"),
      });
    }
    return await prisma.flowActivation.update({
      data: { status: "ACTIVE", webhookSubscriptionId },
      where: { id: activation.id },
    });
  } catch (error) {
    return prisma.flowActivation.update({
      data: { error: describe(error), status: "FAILED" },
      where: { id: activation.id },
    });
  }
};

/** Turns a flow off for a store. Doing it twice is harmless. */
export const deactivateFlow = async (
  scope: FlowScope,
  input: { storeId: string },
  dependencies: ActivationDependencies
): Promise<FlowActivationRecord | null> => {
  const activation = await prisma.flowActivation.findFirst({
    where: {
      flow: { id: scope.flowId, organizationId: scope.organizationId },
      storeId: input.storeId,
    },
  });
  if (!activation) {
    return null;
  }
  let error: string | null = null;
  if (activation.status !== "INACTIVE") {
    try {
      await tearDown(activation, scope.organizationId, dependencies);
    } catch (cause) {
      // The flow is still turned off here, which stops deliveries from
      // starting runs; the leftover subscription is reported.
      error = `Deactivated, but the subscription could not be removed in Shopify: ${describe(cause)}`;
    }
  }
  return prisma.flowActivation.update({
    data: { error, status: "INACTIVE", webhookSubscriptionId: null },
    where: { id: activation.id },
  });
};

/** Turns off every flow activated on a store, before the store is disconnected. */
export const deactivateStoreActivations = async (
  store: { id: string; organizationId: string },
  dependencies: ActivationDependencies
): Promise<void> => {
  const activations = await prisma.flowActivation.findMany({
    where: { status: { not: "INACTIVE" }, storeId: store.id },
  });
  for (const activation of activations) {
    await deactivateFlow(
      { flowId: activation.flowId, organizationId: store.organizationId },
      { storeId: store.id },
      dependencies
    );
  }
};

export type WebhookOutcome =
  | { reason: "unknown" | "unauthorized" | "mismatch"; status: 401 | 404 }
  | { duplicate: boolean; runId: string | null; status: 200 };

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

/**
 * Handles one webhook delivery. The signature over the raw body is checked
 * before the payload is used for anything. A delivery Shopify sends again is
 * recognised by its id and starts nothing.
 */
export const receiveWebhookDelivery = async (
  delivery: {
    activationId: string;
    deliveryId: string | null;
    hmacHeader: string | null;
    rawBody: Uint8Array;
    shopDomainHeader: string | null;
    topicHeader: string | null;
  },
  dependencies: Pick<ActivationDependencies, "jobs" | "registry">
): Promise<WebhookOutcome> => {
  const activation = await prisma.flowActivation.findUnique({
    include: {
      flow: { select: { organizationId: true } },
      flowVersion: true,
      store: { include: { app: true } },
    },
    where: { id: delivery.activationId },
  });
  if (activation?.status !== "ACTIVE") {
    return { reason: "unknown", status: 404 };
  }
  const secret = signingSecret(activation.store);
  if (
    !(
      secret &&
      verifyShopifyWebhookHmac({
        hmacHeader: delivery.hmacHeader,
        rawBody: delivery.rawBody,
        secret,
      })
    )
  ) {
    return { reason: "unauthorized", status: 401 };
  }

  const registry = dependencies.registry ?? builtInRegistry;
  const trigger = triggerOf(
    readDefinition(activation.flowVersion).nodes,
    registry
  );
  if (
    !(
      delivery.deliveryId &&
      delivery.shopDomainHeader?.toLowerCase() ===
        activation.store.shopDomain &&
      matchesWebhookTopic(delivery.topicHeader, String(trigger?.config.topic))
    )
  ) {
    return { reason: "mismatch", status: 401 };
  }

  try {
    await prisma.webhookEvent.create({
      data: {
        eventType: String(trigger?.config.topic),
        externalId: `${activation.id}:${delivery.deliveryId}`,
        // The payload itself is kept once, as the run's trigger item.
        payload: { activationId: activation.id },
        provider: "shopify",
        status: "PROCESSED",
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { duplicate: true, runId: null, status: 200 };
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(
    new TextDecoder().decode(delivery.rawBody)
  );
  const run = await startTriggeredRun(
    {
      flowId: activation.flowId,
      flowVersionId: activation.flowVersionId,
      organizationId: activation.flow.organizationId,
      storeId: activation.storeId,
    },
    {
      payload:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { payload: parsed },
      type: "webhook",
    },
    dependencies.jobs
  );
  return { duplicate: false, runId: run.id, status: 200 };
};
