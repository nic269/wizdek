import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestAgent } from "./support";

const SETUP_TIMEOUT_MS = 600_000;
const RUN_TIMEOUT_MS = 120_000;
const TOKEN = "wfr_sdk-integration-token";

interface Recorded {
  body: unknown;
  path: string;
}

/**
 * Stands in for the API's runtime routes: checks the token, records each
 * call and answers like the real routes. The first GraphQL call is
 * throttled, and the orders connection has two pages.
 */
const startFakeRuntime = async () => {
  const calls: Recorded[] = [];
  let graphqlCalls = 0;

  const answer = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };

  const graphql = (body: { query: string; variables?: { cursor?: string } }) => {
    graphqlCalls += 1;
    if (graphqlCalls === 1) {
      return {
        errors: [{ extensions: { code: "THROTTLED" }, message: "Throttled" }],
        extensions: {
          cost: {
            requestedQueryCost: 10,
            throttleStatus: { currentlyAvailable: 9, restoreRate: 50 },
          },
        },
      };
    }
    if (body.query.includes("orders")) {
      const second = body.variables?.cursor === "page-2";
      return {
        data: {
          orders: {
            edges: second
              ? [{ node: { name: "#3" } }]
              : [{ node: { name: "#1" } }, { node: { name: "#2" } }],
            pageInfo: second
              ? { endCursor: null, hasNextPage: false }
              : { endCursor: "page-2", hasNextPage: true },
          },
        },
      };
    }
    if (body.query.includes("broken")) {
      return { errors: [{ message: "Field 'broken' doesn't exist" }] };
    }
    return { data: { shop: { name: "Fake Store" } } };
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const body = text ? JSON.parse(text) : null;
    const path = (request.url ?? "").replace("/api/fn-runtime", "");
    calls.push({ body, path });
    if (path === "/context") {
      answer(response, 200, {
        grants: { databases: ["analytics"], stores: ["main-store"] },
      });
    } else if (path === "/db/analytics/query") {
      answer(response, 200, {
        command: "SELECT",
        fields: [{ dataTypeId: 23, name: "n" }],
        rowCount: 1,
        rows: [{ n: body.params[0] ?? null }],
        truncated: false,
      });
    } else if (path === "/db/analytics/transaction") {
      answer(response, 200, {
        results: body.statements.map(() => ({
          command: "INSERT",
          fields: [],
          rowCount: 1,
          rows: [],
          truncated: false,
        })),
      });
    } else if (path === "/shopify/main-store/graphql") {
      answer(response, 200, { body: graphql(body) });
    } else {
      answer(response, 403, {
        error: `This function may not use "${path}".`,
      });
    }
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch(() => response.writeHead(500).end());
  });
  server.listen(0, "0.0.0.0");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    reset: () => {
      calls.length = 0;
      graphqlCalls = 0;
    },
    url: `http://host.docker.internal:${port}`,
  };
};

let agent: Awaited<ReturnType<typeof createTestAgent>>;
let runtime: Awaited<ReturnType<typeof startFakeRuntime>>;

const envFor = () => ({
  WIZDEK_FUNCTION_ID: "fn_1",
  WIZDEK_ORGANIZATION_ID: "org_1",
  WIZDEK_RUN_ID: "run_1",
  WIZDEK_RUNTIME_TOKEN: TOKEN,
  WIZDEK_RUNTIME_URL: runtime.url,
  WIZDEK_TRIGGER: "MANUAL",
});

beforeAll(async () => {
  runtime = await startFakeRuntime();
  agent = await createTestAgent();
}, SETUP_TIMEOUT_MS);

beforeEach(() => {
  runtime.reset();
});

afterAll(async () => {
  await runtime?.close();
});

describe("the built-in wizdek module", () => {
  it(
    "gives Node functions databases, stores, paging and the run context",
    async () => {
      const { exit, stderr } = await agent.run({
        env: envFor(),
        files: [
          {
            content: `
              import { ctx, databases, db, shopify, stores, WizdekError } from "wizdek";

              export async function main() {
                const rows = await db("analytics").query("select $1::int as n", [7]);
                const changed = await db("analytics").transaction([
                  { sql: "insert into t values ($1)", params: [1] },
                  { sql: "insert into t values ($1)" },
                ]);
                const { data } = await shopify("main-store").graphql("query { shop { name } }");
                const names = [];
                for await (const order of shopify("main-store").paginate(
                  "query ($cursor: String) { orders(first: 2, after: $cursor) { edges { node { name } } pageInfo { hasNextPage endCursor } } }"
                )) {
                  names.push(order.name);
                }
                let failure = null;
                try {
                  await shopify("main-store").graphql("query { broken }");
                } catch (error) {
                  failure = error instanceof WizdekError ? error.message : "other";
                }
                return {
                  changed: changed.map((result) => result.rowCount),
                  databases: await databases.list(),
                  failure,
                  names,
                  rows,
                  runId: ctx.runId,
                  shop: data.shop.name,
                  stores: await stores.list(),
                };
              }
            `,
            path: "index.ts",
          },
        ],
        runtime: "NODE",
      });

      expect(stderr).toBe("");
      expect(exit).toMatchObject({
        result: {
          changed: [1, 1],
          databases: ["analytics"],
          failure: "Shopify: Field 'broken' doesn't exist",
          names: ["#1", "#2", "#3"],
          rows: [{ n: 7 }],
          runId: "run_1",
          shop: "Fake Store",
          stores: ["main-store"],
        },
        status: "SUCCEEDED",
      });
      expect(runtime.calls.at(1)).toEqual({
        body: {
          statements: [
            { params: [1], sql: "insert into t values ($1)" },
            { params: [], sql: "insert into t values ($1)" },
          ],
        },
        path: "/db/analytics/transaction",
      });
    },
    RUN_TIMEOUT_MS
  );

  it(
    "gives Python functions the same helpers with %s placeholders",
    async () => {
      const { exit, stderr } = await agent.run({
        env: envFor(),
        files: [
          {
            content: [
              "from wizdek import ctx, databases, db, shopify, stores, WizdekError",
              "",
              "def main():",
              "    rows = db('analytics').query('select %s::int as n, 1 %% 2', [7])",
              "    changed = db('analytics').transaction([",
              "        ('insert into t values (%s)', [1]),",
              "        {'sql': 'insert into t values (%s)', 'params': [2]},",
              "    ])",
              "    shop = shopify('main-store').graphql('query { shop { name } }')",
              "    names = [order['name'] for order in shopify('main-store').paginate(",
              "        'query ($cursor: String) { orders(first: 2, after: $cursor) { edges { node { name } } pageInfo { hasNextPage endCursor } } }'",
              "    )]",
              "    try:",
              "        db('warehouse').query('select 1')",
              "        refused = None",
              "    except WizdekError as error:",
              "        refused = error.status",
              "    return {",
              "        'changed': [result['rowCount'] for result in changed],",
              "        'databases': databases.list(),",
              "        'names': names,",
              "        'refused': refused,",
              "        'rows': rows,",
              "        'run_id': ctx.run_id,",
              "        'shop': shop['data']['shop']['name'],",
              "        'stores': stores.list(),",
              "    }",
            ].join("\n"),
            path: "main.py",
          },
        ],
        runtime: "PYTHON",
      });

      expect(stderr).toBe("");
      expect(exit).toMatchObject({
        result: {
          changed: [1, 1],
          databases: ["analytics"],
          names: ["#1", "#2", "#3"],
          refused: 403,
          rows: [{ n: 7 }],
          run_id: "run_1",
          shop: "Fake Store",
          stores: ["main-store"],
        },
        status: "SUCCEEDED",
      });
      expect(runtime.calls[0]).toEqual({
        body: { params: [7], sql: "select $1::int as n, 1 % 2" },
        path: "/db/analytics/query",
      });
    },
    RUN_TIMEOUT_MS
  );

  it(
    "names WIZDEK_RUNTIME_TOKEN when a function runs without one",
    async () => {
      const node = await agent.run({
        files: [
          {
            content: `
              import { db } from "wizdek";
              export async function main() { return db("analytics").query("select 1"); }
            `,
            path: "index.ts",
          },
        ],
        runtime: "NODE",
      });
      expect(node.exit.status).toBe("FAILED");
      expect(node.exit.error).toContain("WIZDEK_RUNTIME_TOKEN");

      const python = await agent.run({
        files: [
          {
            content:
              "from wizdek import db\n\ndef main():\n    return db('analytics').query('select 1')\n",
            path: "main.py",
          },
        ],
        runtime: "PYTHON",
      });
      expect(python.exit.status).toBe("FAILED");
      expect(python.exit.error).toContain("WIZDEK_RUNTIME_TOKEN");
    },
    RUN_TIMEOUT_MS
  );
});
