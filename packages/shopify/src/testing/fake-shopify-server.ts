import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { graphql } from "graphql";
import { fakeShopifySchema } from "./fake-shopify-schema";

export interface FakeOrder {
  id: string;
  name: string;
  tags: string[];
  totalPrice: string;
}

export interface FakeTokenRequest {
  grant:
    | "authorization-code"
    | "token-exchange"
    | "refresh-token"
    | "client-credentials";
  params: Record<string, string>;
}

export interface FakeGraphqlRequest {
  accessToken: string | undefined;
  apiVersion: string;
  costDebug: boolean;
  operationName: string | undefined;
  query: string;
  variables: Record<string, unknown> | undefined;
}

export interface FakeShopifyServerOptions {
  clientId?: string;
  clientSecret?: string;
  port?: number;
  scopes?: string[];
  shop?: { currencyCode: string; myshopifyDomain: string; name: string };
}

export interface FakeShopifyServer {
  /** Makes a token valid for Admin requests, as if it had been issued. */
  acceptToken(token: string): void;
  /** Bulk mutations submitted so far, oldest first. */
  bulkOperations: { id: string; lineCount: number; status: string }[];
  close(): Promise<void>;
  /** The next `count` Admin requests answer HTTP 401. */
  failNextWithUnauthorized(count?: number): void;
  graphqlRequests: FakeGraphqlRequest[];
  order(id: string): FakeOrder | undefined;
  /** The next `count` token requests answer `invalid_grant`. */
  rejectNextTokenRequests(count?: number): void;
  revokeToken(token: string): void;
  seedOrder(order: FakeOrder): void;
  /** How many times an operation reports RUNNING before it completes. */
  setBulkPollsUntilComplete(polls: number): void;
  /** Delays every Admin response, to make a run last long enough to observe. */
  setLatency(milliseconds: number): void;
  /** Answers every `interval`-th Admin request with THROTTLED; 0 turns it off. */
  setThrottleEvery(interval: number): void;
  /** Delays every token response, to widen race windows in tests. */
  setTokenDelay(milliseconds: number): void;
  /** The next `count` Admin requests answer with a THROTTLED error. */
  throttleNext(count?: number): void;
  tokenRequests: FakeTokenRequest[];
  url: string;
  /** Webhook subscriptions currently registered, by id. */
  webhookSubscriptions: Map<string, { topic: string; uri: string }>;
}

const ADMIN_PATH = /^\/admin\/api\/([^/]+)\/graphql\.json$/;
const TOKEN_PATH = "/admin/oauth/access_token";
/**
 * Lets a test in another process seed orders when the server runs on its own,
 * as it does for the browser suite. Accepts a JSON array of orders.
 */
export const SEED_ORDERS_PATH = "/__control/orders";
const STAGED_UPLOAD_PATH = "/__staged-upload";
const BULK_RESULT_PATH = "/__bulk-result";
/** Readiness probe for test runners that wait on a URL. */
export const HEALTH_PATH = "/health";
const NAME_QUERY = /name:\s*"?([^"\s]+)"?/;

const COST = {
  actualQueryCost: 2,
  requestedQueryCost: 3,
  throttleStatus: {
    currentlyAvailable: 1998,
    maximumAvailable: 2000,
    restoreRate: 100,
  },
};

const readRawBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
};

const readBody = async (request: IncomingMessage): Promise<string> =>
  (await readRawBody(request)).toString("utf8");

const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "X-Request-Id": `fake-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...headers,
  });
  response.end(JSON.stringify(body));
};

const parseTokenParams = (
  raw: string,
  contentType: string | undefined
): Record<string, string> => {
  if (contentType?.includes("application/json")) {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)])
    );
  }
  return Object.fromEntries(new URLSearchParams(raw));
};

const grantOf = (
  params: Record<string, string>
): FakeTokenRequest["grant"] | undefined => {
  if (params.grant_type === "client_credentials") {
    return "client-credentials";
  }
  if (params.grant_type === "refresh_token") {
    return "refresh-token";
  }
  if (params.grant_type?.endsWith("token-exchange")) {
    return "token-exchange";
  }
  return params.code ? "authorization-code" : undefined;
};

const toGraphqlOrder = (order: FakeOrder, currencyCode: string) => ({
  id: order.id,
  name: order.name,
  tags: order.tags,
  totalPriceSet: { shopMoney: { amount: order.totalPrice, currencyCode } },
});

/**
 * An in-process stand-in for one Shopify store: the Admin GraphQL endpoint and
 * the OAuth token endpoint. Test-only; it answers for any shop domain.
 */
export const startFakeShopifyServer = async (
  options: FakeShopifyServerOptions = {}
): Promise<FakeShopifyServer> => {
  const clientId = options.clientId ?? "fake-client-id";
  const clientSecret = options.clientSecret ?? "fake-client-secret";
  const scopes = options.scopes ?? ["read_orders", "write_orders"];
  const shop = options.shop ?? {
    currencyCode: "USD",
    myshopifyDomain: "fake-store.myshopify.com",
    name: "Fake Store",
  };

  const validTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  const orders = new Map<string, FakeOrder>();
  const webhookSubscriptions = new Map<
    string,
    { topic: string; uri: string }
  >();
  const stagedUploads = new Map<string, string>();
  const bulkOperations: {
    id: string;
    lineCount: number;
    lines: string[];
    mutation: string;
    pollsLeft: number;
    result: string | null;
    status: string;
  }[] = [];
  let bulkPollsUntilComplete = 2;
  let baseUrl = "";
  const tokenRequests: FakeTokenRequest[] = [];
  const graphqlRequests: FakeGraphqlRequest[] = [];
  let issued = 0;
  let throttled = 0;
  let unauthorized = 0;
  let rejectedTokenRequests = 0;
  let tokenDelay = 0;
  let throttleEvery = 0;
  let latency = 0;
  let adminRequestCount = 0;

  const rootValue = {
    bulkOperation: async ({ id }: { id: string }) => {
      const operation = bulkOperations.find((entry) => entry.id === id);
      if (!operation) {
        return null;
      }
      if (operation.status === "RUNNING") {
        operation.pollsLeft -= 1;
        if (operation.pollsLeft <= 0) {
          // Each input line runs the mutation on its own, as Shopify does.
          const results: string[] = [];
          for (const [lineNumber, line] of operation.lines.entries()) {
            const outcome = await graphql({
              rootValue,
              schema: fakeShopifySchema,
              source: operation.mutation,
              variableValues: JSON.parse(line) as Record<string, unknown>,
            });
            results.push(
              JSON.stringify({ ...outcome, __lineNumber: lineNumber })
            );
          }
          operation.result = `${results.join("\n")}\n`;
          operation.status = "COMPLETED";
        }
      }
      return {
        errorCode: null,
        id: operation.id,
        objectCount: String(operation.lineCount),
        partialDataUrl: null,
        status: operation.status,
        url:
          operation.status === "COMPLETED"
            ? `${baseUrl}${BULK_RESULT_PATH}/${encodeURIComponent(operation.id)}`
            : null,
      };
    },
    bulkOperationRunMutation: ({
      mutation,
      stagedUploadPath,
    }: {
      mutation: string;
      stagedUploadPath: string;
    }) => {
      const uploaded = stagedUploads.get(stagedUploadPath);
      if (uploaded === undefined) {
        return {
          bulkOperation: null,
          userErrors: [
            { field: ["stagedUploadPath"], message: "File not found" },
          ],
        };
      }
      const lines = uploaded.split("\n").filter(Boolean);
      const operation = {
        id: `gid://shopify/BulkOperation/${bulkOperations.length + 1}-${Date.now()}`,
        lineCount: lines.length,
        lines,
        mutation,
        pollsLeft: bulkPollsUntilComplete,
        result: null,
        status: "RUNNING",
      };
      bulkOperations.push(operation);
      return {
        bulkOperation: { id: operation.id, status: "CREATED", url: null },
        userErrors: [],
      };
    },
    currentAppInstallation: () => ({
      accessScopes: scopes.map((handle) => ({ handle })),
      id: "gid://shopify/AppInstallation/1",
    }),
    order: ({ id }: { id: string }) => {
      const order = orders.get(id);
      return order ? toGraphqlOrder(order, shop.currencyCode) : null;
    },
    orders: ({ first, query }: { first?: number; query?: string }) => {
      const name = query?.match(NAME_QUERY)?.[1];
      const nodes = [...orders.values()]
        .filter((order) => !name || order.name === name)
        .slice(0, first ?? 50)
        .map((order) => toGraphqlOrder(order, shop.currencyCode));
      return {
        edges: nodes.map((node) => ({ cursor: node.id, node })),
        nodes,
        pageInfo: { endCursor: nodes.at(-1)?.id ?? null, hasNextPage: false },
      };
    },
    publicApiVersions: () => [
      { displayName: "2026-04", handle: "2026-04", supported: true },
      { displayName: "2026-07 (Latest)", handle: "2026-07", supported: true },
      {
        displayName: "2026-10 (Release candidate)",
        handle: "2026-10",
        supported: false,
      },
      { displayName: "unstable", handle: "unstable", supported: false },
    ],
    shop: () => ({ id: "gid://shopify/Shop/1", ...shop }),
    stagedUploadsCreate: ({ input }: { input: { filename: string }[] }) => ({
      stagedTargets: input.map(({ filename }) => {
        const key = `tmp/bulk/${Date.now()}-${Math.random().toString(16).slice(2)}/${filename}`;
        return {
          parameters: [
            { name: "key", value: key },
            { name: "Content-Type", value: "text/jsonl" },
          ],
          resourceUrl: null,
          url: `${baseUrl}${STAGED_UPLOAD_PATH}`,
        };
      }),
      userErrors: [],
    }),
    tagsAdd: ({ id, tags }: { id: string; tags: string[] }) => {
      const order = orders.get(id);
      if (!order) {
        return {
          node: null,
          userErrors: [{ field: ["id"], message: "Order does not exist" }],
        };
      }
      order.tags = [...new Set([...order.tags, ...tags])].sort();
      return {
        node: {
          __typename: "Order",
          ...toGraphqlOrder(order, shop.currencyCode),
        },
        userErrors: [],
      };
    },
    webhookSubscriptionCreate: ({
      topic,
      webhookSubscription,
    }: {
      topic: string;
      webhookSubscription: { uri?: string };
    }) => {
      const uri = webhookSubscription.uri ?? "";
      if (!(uri.startsWith("https://") || uri.startsWith("http://"))) {
        return {
          userErrors: [{ field: ["uri"], message: "Address is invalid" }],
          webhookSubscription: null,
        };
      }
      const id = `gid://shopify/WebhookSubscription/${webhookSubscriptions.size + 1}-${Date.now()}`;
      webhookSubscriptions.set(id, { topic, uri });
      return { userErrors: [], webhookSubscription: { id, topic, uri } };
    },
    webhookSubscriptionDelete: ({ id }: { id: string }) => ({
      deletedWebhookSubscriptionId: webhookSubscriptions.delete(id) ? id : null,
      userErrors: [],
    }),
  };

  const issueToken = (grant: FakeTokenRequest["grant"], expiring: boolean) => {
    issued += 1;
    const accessToken = `shpat_fake_${issued}`;
    validTokens.add(accessToken);
    if (grant === "client-credentials") {
      return {
        access_token: accessToken,
        expires_in: 86_399,
        scope: scopes.join(","),
      };
    }
    if (!expiring) {
      return { access_token: accessToken, scope: scopes.join(",") };
    }
    const refreshToken = `shprt_fake_${issued}`;
    refreshTokens.add(refreshToken);
    return {
      access_token: accessToken,
      expires_in: 3600,
      refresh_token: refreshToken,
      refresh_token_expires_in: 7_776_000,
      scope: scopes.join(","),
    };
  };

  const handleToken = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    const params = parseTokenParams(
      await readBody(request),
      request.headers["content-type"]
    );
    const grant = grantOf(params);
    if (!grant) {
      sendJson(response, 400, { error: "invalid_request" });
      return;
    }
    tokenRequests.push({ grant, params });
    if (tokenDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, tokenDelay));
    }
    if (
      params.client_id !== clientId ||
      params.client_secret !== clientSecret
    ) {
      sendJson(response, 401, { error: "invalid_client" });
      return;
    }
    if (rejectedTokenRequests > 0) {
      rejectedTokenRequests -= 1;
      sendJson(response, 400, { error: "invalid_grant" });
      return;
    }
    if (grant === "refresh-token") {
      // Rotation: a refresh token works once, then its replacement takes over.
      if (
        !(params.refresh_token && refreshTokens.delete(params.refresh_token))
      ) {
        sendJson(response, 400, { error: "invalid_grant" });
        return;
      }
      sendJson(response, 200, issueToken(grant, true));
      return;
    }
    sendJson(response, 200, issueToken(grant, params.expiring === "1"));
  };

  const handleGraphql = async (
    request: IncomingMessage,
    response: ServerResponse,
    apiVersion: string
  ): Promise<void> => {
    const payload = JSON.parse(await readBody(request)) as {
      operationName?: string;
      query: string;
      variables?: Record<string, unknown>;
    };
    const header = request.headers["x-shopify-access-token"];
    const accessToken = Array.isArray(header) ? header[0] : header;
    const costDebug = request.headers["shopify-graphql-cost-debug"] === "1";
    graphqlRequests.push({
      accessToken,
      apiVersion,
      costDebug,
      operationName: payload.operationName,
      query: payload.query,
      variables: payload.variables,
    });

    if (unauthorized > 0 || !(accessToken && validTokens.has(accessToken))) {
      unauthorized = Math.max(0, unauthorized - 1);
      sendJson(response, 401, {
        errors:
          "[API] Invalid API key or access token (unrecognized login or wrong password)",
      });
      return;
    }

    const cost = costDebug
      ? { ...COST, fields: [{ path: ["shop"], requestedTotalCost: 1 }] }
      : COST;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
    adminRequestCount += 1;
    if (throttleEvery > 0 && adminRequestCount % throttleEvery === 0) {
      throttled += 1;
    }
    if (throttled > 0) {
      throttled -= 1;
      sendJson(response, 200, {
        errors: [{ extensions: { code: "THROTTLED" }, message: "Throttled" }],
        extensions: {
          cost: {
            ...cost,
            throttleStatus: { ...COST.throttleStatus, currentlyAvailable: 0 },
          },
        },
      });
      return;
    }

    const result = await graphql({
      operationName: payload.operationName ?? null,
      rootValue,
      schema: fakeShopifySchema,
      source: payload.query,
      variableValues: payload.variables ?? null,
    });
    sendJson(response, 200, { ...result, extensions: { cost } });
  };

  const handleBulkResult = (path: string, response: ServerResponse) => {
    const id = decodeURIComponent(path.slice(BULK_RESULT_PATH.length + 1));
    const operation = bulkOperations.find((entry) => entry.id === id);
    response.writeHead(operation?.result ? 200 : 404, {
      "Content-Type": "application/jsonl",
    });
    response.end(operation?.result ?? "");
  };

  const handleStagedUpload = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    // The web platform parses the multipart form for us.
    const form = await new Response(
      new Uint8Array(await readRawBody(request)),
      {
        headers: { "content-type": request.headers["content-type"] ?? "" },
      }
    ).formData();
    const file = form.get("file");
    stagedUploads.set(
      String(form.get("key")),
      typeof file === "string" ? file : await (file as File).text()
    );
    response.writeHead(201);
    response.end();
  };

  const handleSeedOrders = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    for (const order of JSON.parse(await readBody(request)) as FakeOrder[]) {
      orders.set(order.id, { ...order, tags: [...order.tags] });
    }
    sendJson(response, 200, { seeded: true });
  };

  /** Picks the handler for a request; undefined means there is none. */
  const route = (
    request: IncomingMessage,
    response: ServerResponse,
    path: string
  ): Promise<void> | undefined => {
    if (request.method === "GET") {
      if (path === HEALTH_PATH) {
        sendJson(response, 200, { status: "ok" });
        return Promise.resolve();
      }
      if (path.startsWith(`${BULK_RESULT_PATH}/`)) {
        handleBulkResult(path, response);
        return Promise.resolve();
      }
      return;
    }
    if (request.method !== "POST") {
      return;
    }
    const postRoutes: Record<string, () => Promise<void>> = {
      [SEED_ORDERS_PATH]: () => handleSeedOrders(request, response),
      [STAGED_UPLOAD_PATH]: () => handleStagedUpload(request, response),
      [TOKEN_PATH]: () => handleToken(request, response),
    };
    const apiVersion = path.match(ADMIN_PATH)?.[1];
    if (apiVersion) {
      return handleGraphql(request, response, apiVersion);
    }
    return postRoutes[path]?.();
  };

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fake").pathname;
    const handled = route(request, response, path);
    if (!handled) {
      sendJson(response, 404, { errors: "Not Found" });
      return;
    }
    handled.catch(() => {
      if (!response.headersSent) {
        sendJson(response, 400, { errors: "Bad Request" });
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  return {
    acceptToken: (token) => {
      validTokens.add(token);
    },
    bulkOperations,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    failNextWithUnauthorized: (count = 1) => {
      unauthorized += count;
    },
    graphqlRequests,
    order: (id) => orders.get(id),
    rejectNextTokenRequests: (count = 1) => {
      rejectedTokenRequests += count;
    },
    revokeToken: (token) => {
      validTokens.delete(token);
    },
    seedOrder: (order) => {
      orders.set(order.id, { ...order, tags: [...order.tags] });
    },
    setBulkPollsUntilComplete: (polls) => {
      bulkPollsUntilComplete = polls;
    },
    setLatency: (milliseconds) => {
      latency = milliseconds;
    },
    setThrottleEvery: (interval) => {
      throttleEvery = interval;
    },
    setTokenDelay: (milliseconds) => {
      tokenDelay = milliseconds;
    },
    throttleNext: (count = 1) => {
      throttled += count;
    },
    tokenRequests,
    url: `http://127.0.0.1:${port}`,
    webhookSubscriptions,
  };
};
