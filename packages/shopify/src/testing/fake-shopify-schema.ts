import { buildSchema } from "graphql";

/** A small slice of the Admin API: enough for health checks, lookups and tagging. */
export const fakeShopifySchema = buildSchema(`
  interface Node { id: ID! }

  type Shop {
    id: ID!
    name: String!
    myshopifyDomain: String!
    currencyCode: String!
  }

  type AccessScope { handle: String! }
  type AppInstallation { id: ID! accessScopes: [AccessScope!]! }

  type MoneyV2 { amount: String! currencyCode: String! }
  type MoneyBag { shopMoney: MoneyV2! }

  type Order implements Node {
    id: ID!
    name: String!
    tags: [String!]!
    totalPriceSet: MoneyBag!
  }

  type OrderEdge { cursor: String! node: Order! }
  type PageInfo { hasNextPage: Boolean! endCursor: String }
  type OrderConnection {
    edges: [OrderEdge!]!
    nodes: [Order!]!
    pageInfo: PageInfo!
  }

  type UserError { field: [String!] message: String! }
  type TagsAddPayload { node: Node userErrors: [UserError!]! }

  type ApiVersion { handle: String! displayName: String! supported: Boolean! }

  type Query {
    publicApiVersions: [ApiVersion!]!
    shop: Shop!
    currentAppInstallation: AppInstallation!
    order(id: ID!): Order
    orders(first: Int, query: String): OrderConnection!
  }

  scalar WebhookSubscriptionTopic
  type WebhookSubscription { id: ID! topic: String! uri: String! }
  input WebhookSubscriptionInput { uri: String }
  type WebhookSubscriptionCreatePayload {
    webhookSubscription: WebhookSubscription
    userErrors: [UserError!]!
  }
  type WebhookSubscriptionDeletePayload {
    deletedWebhookSubscriptionId: ID
    userErrors: [UserError!]!
  }

  type Mutation {
    webhookSubscriptionCreate(
      topic: WebhookSubscriptionTopic!
      webhookSubscription: WebhookSubscriptionInput!
    ): WebhookSubscriptionCreatePayload
    webhookSubscriptionDelete(id: ID!): WebhookSubscriptionDeletePayload
    tagsAdd(id: ID!, tags: [String!]!): TagsAddPayload
  }
`);
