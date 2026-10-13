import { throwShopifyUserErrors } from "../admin/errors";
import type { StoreClient } from "../stores/store-client";

const CREATE_MUTATION = `mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`;

const DELETE_MUTATION = `mutation WebhookSubscriptionDelete($id: ID!) {
  webhookSubscriptionDelete(id: $id) {
    deletedWebhookSubscriptionId
    userErrors { field message }
  }
}`;

interface UserError {
  field: string[] | null;
  message: string;
}

type SubscriptionClient = Pick<StoreClient, "requestOrThrow" | "store">;

/** Subscribes the store to a topic and returns the subscription's id. */
export const createWebhookSubscription = async (
  client: SubscriptionClient,
  input: { topic: string; uri: string }
): Promise<string> => {
  const data = await client.requestOrThrow<{
    webhookSubscriptionCreate: {
      userErrors: UserError[];
      webhookSubscription: { id: string } | null;
    } | null;
  }>({
    operationName: "WebhookSubscriptionCreate",
    query: CREATE_MUTATION,
    variables: {
      topic: input.topic,
      webhookSubscription: { uri: input.uri },
    },
  });
  throwShopifyUserErrors({
    operationName: "webhookSubscriptionCreate",
    shopDomain: client.store.shopDomain,
    userErrors: data.webhookSubscriptionCreate?.userErrors,
  });
  const id = data.webhookSubscriptionCreate?.webhookSubscription?.id;
  if (!id) {
    throw new Error("Shopify did not return the webhook subscription.");
  }
  return id;
};

/** Removes a subscription. One that is already gone is not an error. */
export const deleteWebhookSubscription = async (
  client: SubscriptionClient,
  subscriptionId: string
): Promise<void> => {
  await client.requestOrThrow({
    operationName: "WebhookSubscriptionDelete",
    query: DELETE_MUTATION,
    variables: { id: subscriptionId },
  });
};
