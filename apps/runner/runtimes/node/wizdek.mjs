// The `wizdek` module functions import. It reaches the organization's granted
// databases and Shopify stores through Wizdek's runtime API with the run's
// token; no connection string or store token ever enters the sandbox.

const PATH_PREFIX = "/api/fn-runtime";
const TRAILING_SLASHES = /\/+$/;
const MAX_THROTTLE_RETRIES = 5;
const MAX_THROTTLE_WAIT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 90_000;

/** A helper call that failed; `status` is the runtime API's HTTP status. */
export class WizdekError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WizdekError";
    this.status = details.status ?? null;
    /** Shopify's `errors`, for a GraphQL call. */
    this.errors = details.errors ?? null;
    /** Shopify's whole answer, for a GraphQL call. */
    this.response = details.response ?? null;
  }
}

const settings = () => {
  const token = process.env.WIZDEK_RUNTIME_TOKEN;
  const url = process.env.WIZDEK_RUNTIME_URL;
  if (!(token && url)) {
    throw new WizdekError(
      "The wizdek helpers work only inside a Wizdek run: WIZDEK_RUNTIME_TOKEN is not set."
    );
  }
  return { token, url: url.replace(TRAILING_SLASHES, "") };
};

const call = async (method, path, body) => {
  const { token, url } = settings();
  let response;
  try {
    response = await fetch(`${url}${PATH_PREFIX}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WizdekError(`Could not reach Wizdek: ${error.message}`);
  }
  if (response.status === 401) {
    throw new WizdekError(
      "Wizdek refused this run's helper token: the run has ended.",
      { status: 401 }
    );
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Reported below with the status.
  }
  if (!response.ok) {
    throw new WizdekError(
      json?.error ?? `Wizdek answered ${response.status}.`,
      {
        status: response.status,
      }
    );
  }
  return json;
};

const segment = (alias) => {
  if (typeof alias !== "string" || alias === "") {
    throw new WizdekError("Name the store or database by its alias or id.");
  }
  return encodeURIComponent(alias);
};

const warnTruncated = (alias, result) => {
  if (result.truncated) {
    console.warn(
      `wizdek: the result from "${alias}" was cut at the row or size limit; page through it with LIMIT and OFFSET.`
    );
  }
};

/** What the run is: ids, and what started it. */
export const ctx = Object.freeze({
  get functionId() {
    return process.env.WIZDEK_FUNCTION_ID ?? null;
  },
  get organizationId() {
    return process.env.WIZDEK_ORGANIZATION_ID ?? null;
  },
  get runId() {
    return process.env.WIZDEK_RUN_ID ?? null;
  },
  get trigger() {
    return process.env.WIZDEK_TRIGGER ?? null;
  },
});

/** A database connection granted to this function, by alias or id. */
export const db = (alias) => {
  const base = `/db/${segment(alias)}`;
  return {
    /** Runs one statement and returns how many rows it changed. */
    async execute(sql, params = []) {
      return (await this.run(sql, params)).rowCount;
    },
    /** Runs one statement and returns its rows. Use `$1`, `$2` for values. */
    async query(sql, params = []) {
      return (await this.run(sql, params)).rows;
    },
    /** Runs one statement and returns its result: command, rows, fields. */
    async run(sql, params = []) {
      const result = await call("POST", `${base}/query`, { params, sql });
      warnTruncated(alias, result);
      return result;
    },
    /**
     * Runs statements in one transaction: all of them, or none when one
     * fails. Each is `{ sql, params }`; returns their results in order.
     */
    async transaction(statements) {
      if (!Array.isArray(statements) || statements.length === 0) {
        throw new WizdekError(
          "Pass the transaction's statements as a list of { sql, params }."
        );
      }
      const { results } = await call("POST", `${base}/transaction`, {
        statements: statements.map(({ params = [], sql }) => ({ params, sql })),
      });
      for (const result of results) {
        warnTruncated(alias, result);
      }
      return results;
    },
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isThrottled = (body) =>
  Array.isArray(body?.errors) &&
  body.errors.some((error) => error?.extensions?.code === "THROTTLED");

/** How long Shopify needs to restore enough of the cost bucket. */
const throttleWaitMs = (body) => {
  const cost = body?.extensions?.cost;
  const status = cost?.throttleStatus;
  if (!status?.restoreRate) {
    return 1000;
  }
  const missing =
    (cost.requestedQueryCost ?? 0) - (status.currentlyAvailable ?? 0);
  const seconds = Math.max(1, Math.ceil(missing / status.restoreRate));
  return Math.min(seconds * 1000, MAX_THROTTLE_WAIT_MS);
};

const valueAt = (data, path) => {
  if (!path) {
    const keys = Object.keys(data ?? {});
    if (keys.length !== 1) {
      throw new WizdekError(
        'Give paginate a path, such as { path: "orders" }: the query selects more than one field.'
      );
    }
    return data[keys[0]];
  }
  return path.split(".").reduce((value, key) => value?.[key], data);
};

/** A Shopify store granted to this function, by alias or id. */
export const shopify = (alias) => {
  const path = `/shopify/${segment(alias)}/graphql`;
  const store = {
    /**
     * Runs an Admin API query or mutation and returns Shopify's answer
     * (`data`, `extensions`). Throttled calls are retried; other GraphQL
     * errors throw. `userErrors` in a mutation's payload are left to you.
     */
    async graphql(query, variables, options = {}) {
      for (let attempt = 0; ; attempt += 1) {
        const { body } = await call("POST", path, {
          apiVersion: options.apiVersion,
          operationName: options.operationName,
          query,
          variables,
        });
        if (isThrottled(body) && attempt < MAX_THROTTLE_RETRIES) {
          await sleep(throttleWaitMs(body));
          continue;
        }
        if (Array.isArray(body?.errors) && body.errors.length > 0) {
          const messages = body.errors.map((error) => error?.message);
          throw new WizdekError(`Shopify: ${messages.join("; ")}`, {
            errors: body.errors,
            response: body,
          });
        }
        return body;
      }
    },
    /**
     * Pages through a connection and yields its nodes. The query takes a
     * `$cursor: String` variable for `after:` and selects
     * `pageInfo { hasNextPage endCursor }`; `path` names the connection
     * inside `data`, such as "orders".
     */
    async *paginate(query, variables = {}, options = {}) {
      let cursor = null;
      do {
        const { data } = await store.graphql(
          query,
          { ...variables, cursor },
          options
        );
        const connection = valueAt(data, options.path);
        if (!connection) {
          throw new WizdekError(
            `No connection at "${options.path ?? "the only field"}" in the answer.`
          );
        }
        const nodes =
          connection.nodes ?? connection.edges?.map((edge) => edge.node) ?? [];
        yield* nodes;
        cursor = connection.pageInfo?.hasNextPage
          ? connection.pageInfo.endCursor
          : null;
      } while (cursor);
    },
  };
  return store;
};

let context;
const grants = async () => {
  context ??= call("GET", "/context");
  return (await context).grants;
};

/** The stores this function may use, by alias. */
export const stores = { list: async () => (await grants()).stores };

/** The database connections this function may use, by alias. */
export const databases = { list: async () => (await grants()).databases };
