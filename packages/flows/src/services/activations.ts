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
import { recordFlowAudit } from "./audit";
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
  const { flow, version } = await getFlow(scope);
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
    return await finishActivation(activation.id, {
      data: { status: "ACTIVE", webhookSubscriptionId },
      event: { actorId: input.actorId, flowName: flow.name, scope, store },
    });
  } catch (error) {
    return finishActivation(activation.id, {
      data: { error: describe(error), status: "FAILED" },
      event: { actorId: input.actorId, flowName: flow.name, scope, store },
    });
  }
};

/**
 * Records an activation's outcome together with its audit event. A failed
 * activation is still recorded, with the status saying it failed.
 */
const finishActivation = (
  activationId: string,
  outcome: {
    data: Prisma.FlowActivationUpdateInput;
    event: {
      actorId: string;
      flowName: string;
      scope: FlowScope;
      store: { shopDomain: string };
    };
  }
) =>
  prisma.$transaction(async (transaction) => {
    const activation = await transaction.flowActivation.update({
      data: outcome.data,
      where: { id: activationId },
    });
    await recordFlowAudit(transaction, {
      action: "flow.activated",
      actorId: outcome.event.actorId,
      metadata: {
        flowName: outcome.event.flowName,
        shopDomain: outcome.event.store.shopDomain,
        status: activation.status,
      },
      organizationId: outcome.event.scope.organizationId,
      targetId: activation.id,
      targetType: "FlowActivation",
    });
    return activation;
  });

/** Turns a flow off for a store. Doing it twice is harmless. */
export const deactivateFlow = async (
  scope: FlowScope,
  input: { actorId: string; storeId: string },
  dependencies: ActivationDependencies
): Promise<FlowActivationRecord | null> => {
  const activation = await prisma.flowActivation.findFirst({
    include: {
      flow: { select: { name: true } },
      store: { select: { shopDomain: true } },
    },
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
  const wasOn = activation.status !== "INACTIVE";
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.flowActivation.update({
      data: { error, status: "INACTIVE", webhookSubscriptionId: null },
      where: { id: activation.id },
    });
    // Turning off what is already off changes nothing worth recording.
    if (wasOn) {
      await recordFlowAudit(transaction, {
        action: "flow.deactivated",
        actorId: input.actorId,
        metadata: {
          flowName: activation.flow.name,
          shopDomain: activation.store.shopDomain,
        },
        organizationId: scope.organizationId,
        targetId: activation.id,
        targetType: "FlowActivation",
      });
    }
    return updated;
  });
};

/** Turns off every flow activated on a store, before the store is disconnected. */
export const deactivateStoreActivations = async (
  store: { id: string; organizationId: string },
  dependencies: ActivationDependencies,
  actorId: string
): Promise<void> => {
  const activations = await prisma.flowActivation.findMany({
    where: { status: { not: "INACTIVE" }, storeId: store.id },
  });
  for (const activation of activations) {
    await deactivateFlow(
      { flowId: activation.flowId, organizationId: store.organizationId },
      { actorId, storeId: store.id },
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

/**
 * How much of the organization's flow work depends on a store, so removing
 * it can state its impact: flows that ran on it or are activated on it.
 */
export const countStoreUsage = async (scope: {
  organizationId: string;
  storeId: string;
}) => {
  const where = {
    organizationId: scope.organizationId,
    storeId: scope.storeId,
  };
  const activeWhere = {
    flow: { organizationId: scope.organizationId },
    status: "ACTIVE" as const,
    storeId: scope.storeId,
  };
  const [runCount, activationCount, runFlows, activeFlows] = await Promise.all([
    prisma.flowRun.count({ where }),
    prisma.flowActivation.count({ where: activeWhere }),
    prisma.flowRun.findMany({
      distinct: ["flowId"],
      select: { flowId: true },
      where,
    }),
    prisma.flowActivation.findMany({
      distinct: ["flowId"],
      select: { flowId: true },
      where: activeWhere,
    }),
  ]);
  const flowIds = new Set(
    [...runFlows, ...activeFlows].map(({ flowId }) => flowId)
  );
  return { activationCount, flowCount: flowIds.size, runCount };
};
