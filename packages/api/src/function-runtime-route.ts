import {
  DatabaseToolsError,
  getConnection,
  openConnection,
  type QueryResult,
  type QueryStatement,
  redactSecrets,
} from "@repo/database-tools";
import {
  authenticateRuntimeToken,
  countRuntimeCall,
  grantedAliases,
  type RuntimeRun,
  recordDatabaseWrite,
  resolveGrant,
} from "@repo/functions";
import {
  isReadStatement,
  RUNTIME_LIMITS,
  RUNTIME_PATH_PREFIX,
} from "@repo/functions/definition";
import {
  executeGraphqlForUser,
  GraphqlDocumentError,
  ShopifyGraphqlError,
  ShopifyTransportError,
} from "@repo/shopify";
import {
  StoreNotFoundError,
  StoreReconnectRequiredError,
} from "@repo/shopify/stores";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

const BEARER = /^Bearer\s+(\S+)$/i;
/** A call never gets less than this, so a run's last second can still ask. */
const MIN_CALL_TIMEOUT_MS = 1000;
const MAX_AUDITED_SQL_LENGTH = 2000;

interface RuntimeEnv {
  Variables: { run: RuntimeRun };
}
type RuntimeContext = Context<RuntimeEnv>;

const statementSchema = z.object({
  params: z.array(z.unknown()).max(1000).default([]),
  sql: z.string().trim().min(1).max(100_000),
});

const transactionSchema = z.object({
  statements: z
    .array(statementSchema)
    .min(1)
    .max(RUNTIME_LIMITS.transactionStatements),
});

const graphqlSchema = z.object({
  apiVersion: z.string().max(20).optional(),
  operationName: z.string().max(200).optional(),
  query: z.string().min(1).max(100_000),
  variables: z.record(z.string(), z.unknown()).optional(),
});

/** How long a call may take: what is left of the run, at most a minute. */
const callTimeoutOf = (run: RuntimeRun): number => {
  const budgetMs = run.function.timeoutSeconds * 1000;
  const leftMs = run.startedAt
    ? run.startedAt.getTime() + budgetMs - Date.now()
    : budgetMs;
  return Math.max(
    MIN_CALL_TIMEOUT_MS,
    Math.min(RUNTIME_LIMITS.callTimeoutMs, leftMs)
  );
};

const bodyOf = async <T>(
  context: RuntimeContext,
  schema: z.ZodType<T>
): Promise<T | null> => {
  const parsed = schema.safeParse(
    await context.req.json().catch(() => undefined)
  );
  return parsed.success ? parsed.data : null;
};

const invalidBody = (context: RuntimeContext) =>
  context.json({ error: "The request body is not valid for this call." }, 422);

const notGranted = (context: RuntimeContext, what: string, alias: string) =>
  context.json(
    {
      error: `This function may not use the ${what} "${alias}". Add it under Connections in the function's settings.`,
    },
    403
  );

/** Counts calls in flight per run, overall and for databases. */
const createInFlightCounter = () => {
  const counts = new Map<string, { all: number; database: number }>();
  return {
    acquire(runId: string, database: boolean): boolean {
      const count = counts.get(runId) ?? { all: 0, database: 0 };
      if (
        count.all >= RUNTIME_LIMITS.callsInFlight ||
        (database && count.database >= RUNTIME_LIMITS.databaseCallsInFlight)
      ) {
        return false;
      }
      count.all += 1;
      count.database += database ? 1 : 0;
      counts.set(runId, count);
      return true;
    },
    release(runId: string, database: boolean) {
      const count = counts.get(runId);
      if (!count) {
        return;
      }
      count.all -= 1;
      count.database -= database ? 1 : 0;
      if (count.all <= 0) {
        counts.delete(runId);
      }
    },
  };
};

/**
 * Runs statements on a granted database connection: one on its own, several
 * as one transaction. Calls that may change data are audited.
 */
const runDatabaseCall = async (
  context: RuntimeContext,
  statements: QueryStatement[]
) => {
  const run = context.get("run");
  const alias = context.req.param("alias") ?? "";
  const grant = await resolveGrant(run.function.id, "DATABASE", alias);
  if (!grant) {
    return notGranted(context, "database", alias);
  }
  const connection = await getConnection({
    connectionId: grant.resourceId,
    organizationId: run.function.organizationId,
  }).catch(() => null);
  if (!connection) {
    return notGranted(context, "database", alias);
  }
  await countRuntimeCall(run.id, "DATABASE");
  const { adapter, secrets, target } = openConnection(connection);
  const writes = statements.filter(({ sql }) => !isReadStatement(sql));
  const audit = (outcome: { error?: string; results?: QueryResult[] }) =>
    writes.length === 0
      ? undefined
      : recordDatabaseWrite(run, {
          alias: grant.alias,
          connectionId: connection.id,
          connectionName: connection.name,
          databaseName: connection.databaseName,
          environment: connection.environment,
          statements: statements.map(({ sql }, index) => ({
            command: outcome.results?.[index]?.command ?? null,
            rowCount: outcome.results?.[index]?.rowCount ?? null,
            sql: sql.slice(0, MAX_AUDITED_SQL_LENGTH),
          })),
          succeeded: outcome.error === undefined,
          ...(outcome.error === undefined ? {} : { error: outcome.error }),
        });
  try {
    const results = await adapter.query(target, statements, {
      maxBytes: RUNTIME_LIMITS.maxResponseBytes,
      maxRows: RUNTIME_LIMITS.maxRows,
      timeoutMs: callTimeoutOf(run),
    });
    await audit({ results });
    return results;
  } catch (error) {
    if (!(error instanceof DatabaseToolsError)) {
      throw error;
    }
    const message = redactSecrets(error.message, secrets);
    await audit({ error: message });
    return context.json(
      { error: message },
      error.failure === "CONNECTION_FAILED" ? 502 : 422
    );
  }
};

/**
 * The API a running function's `wizdek` helpers call. The run's token is the
 * only credential: it names one run, works only while that run is queued or
 * running, and reaches only the stores and databases granted to its
 * function. Every refusal of the token is the same empty 401.
 */
export const createFunctionRuntimeRoutes = () => {
  const inFlight = createInFlightCounter();
  const routes = new Hono<RuntimeEnv>();

  routes.use(
    "*",
    bodyLimit({
      maxSize: RUNTIME_LIMITS.maxBodyBytes,
      onError: (context) => context.body(null, 413),
    })
  );
  routes.use("*", async (context, next) => {
    const token =
      BEARER.exec(context.req.header("authorization") ?? "")?.[1] ?? null;
    const run = await authenticateRuntimeToken(token);
    if (!run) {
      return context.body(null, 401);
    }
    context.set("run", run);
    const database = context.req.path.includes("/db/");
    if (!inFlight.acquire(run.id, database)) {
      return context.json(
        { error: "Too many helper calls in flight for this run." },
        429
      );
    }
    try {
      await next();
    } finally {
      inFlight.release(run.id, database);
    }
  });

  routes.get("/context", async (context) => {
    const run = context.get("run");
    return context.json({
      functionId: run.function.id,
      functionName: run.function.name,
      grants: await grantedAliases(run.function.id),
      organizationId: run.function.organizationId,
      runId: run.id,
      trigger: run.trigger,
    });
  });

  routes.post("/db/:alias/query", async (context) => {
    const body = await bodyOf(context, statementSchema);
    if (!body) {
      return invalidBody(context);
    }
    const outcome = await runDatabaseCall(context, [body]);
    return Array.isArray(outcome) ? context.json(outcome[0]) : outcome;
  });

  routes.post("/db/:alias/transaction", async (context) => {
    const body = await bodyOf(context, transactionSchema);
    if (!body) {
      return invalidBody(context);
    }
    const outcome = await runDatabaseCall(context, body.statements);
    return Array.isArray(outcome)
      ? context.json({ results: outcome })
      : outcome;
  });

  routes.post("/shopify/:alias/graphql", async (context) => {
    const run = context.get("run");
    const alias = context.req.param("alias");
    const body = await bodyOf(context, graphqlSchema);
    if (!body) {
      return invalidBody(context);
    }
    const grant = await resolveGrant(run.function.id, "STORE", alias);
    if (!grant) {
      return notGranted(context, "store", alias);
    }
    await countRuntimeCall(run.id, "STORE");
    try {
      const result = await executeGraphqlForUser({
        actorId: run.startedById,
        apiVersion: body.apiVersion,
        auditMetadata: {
          functionId: run.function.id,
          functionName: run.function.name,
          runId: run.id,
        },
        // Queries are counted on the run; mutations are audited as usual.
        auditQueries: false,
        // The grant is the permission: whoever granted the store could mutate.
        canMutate: () => Promise.resolve(true),
        operationName: body.operationName,
        query: body.query,
        scope: {
          organizationId: run.function.organizationId,
          storeId: grant.resourceId,
        },
        timeoutMs: callTimeoutOf(run),
        variables: body.variables,
      });
      return context.json({
        body: result.body,
        cost: result.cost,
        httpStatus: result.httpStatus,
        shopifyRequestId: result.shopifyRequestId,
      });
    } catch (error) {
      if (error instanceof StoreNotFoundError) {
        return notGranted(context, "store", alias);
      }
      if (error instanceof GraphqlDocumentError) {
        return context.json({ error: error.message }, 422);
      }
      if (error instanceof StoreReconnectRequiredError) {
        return context.json(
          {
            error: `The store "${alias}" needs to be reconnected in Wizdek before it can be used.`,
          },
          409
        );
      }
      if (
        error instanceof ShopifyTransportError ||
        error instanceof ShopifyGraphqlError
      ) {
        return context.json({ error: error.message }, 502);
      }
      throw error;
    }
  });

  return routes;
};

/**
 * The app served on the runtime port: only the helper routes, so publishing
 * that port to the runner exposes nothing else of the API.
 */
export const createFunctionRuntimeApp = () => {
  const app = new Hono();
  app.route(RUNTIME_PATH_PREFIX, createFunctionRuntimeRoutes());
  app.notFound((context) => context.body(null, 404));
  app.onError((error, context) => {
    console.error("function_runtime.unhandled_error", error.message);
    return context.json({ error: "An unexpected error occurred." }, 500);
  });
  return app;
};
