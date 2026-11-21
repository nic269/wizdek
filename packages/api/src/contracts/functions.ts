import { isCronExpression, isTimeZone } from "@repo/flows/definition";
import {
  ENV_VAR_LIMITS,
  FUNCTION_DEPS_STATUSES,
  FUNCTION_LIMITS,
  FUNCTION_RUN_STATUSES,
  FUNCTION_RUNTIMES,
  GRANT_ALIAS,
  GRANT_KINDS,
} from "@repo/functions/definition";
import { z } from "zod";
import {
  apiContract,
  cursorPaginationInputSchema,
  dataEnvelope,
  paginatedDataEnvelope,
} from "./base";
import { organizationIdInput } from "./shopify-shared";

export const functionRuntimeSchema = z.enum(FUNCTION_RUNTIMES);
export const functionRunStatusSchema = z.enum(FUNCTION_RUN_STATUSES);
export const functionDepsStatusSchema = z.enum(FUNCTION_DEPS_STATUSES);
export const functionRunTriggerSchema = z.enum(["MANUAL", "HTTP", "SCHEDULE"]);

const paramTypeSchema = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "array",
]);

export const paramSchemaSchema = z.object({
  default: z.unknown().optional(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  items: z.object({ type: paramTypeSchema.exclude(["array"]) }).optional(),
  type: paramTypeSchema.optional(),
});

/** The form fields read from `main`, in declaration order. */
export const paramsSchemaSchema = z.object({
  properties: z.record(z.string(), paramSchemaSchema),
  required: z.array(z.string()),
  type: z.literal("object"),
  "x-order": z.array(z.string()),
});

export const functionFileSchema = z.object({
  content: z.string(),
  path: z.string(),
});

export const functionSummarySchema = z.object({
  createdAt: z.date(),
  /** When the installed packages were built. */
  depsBuiltAt: z.date().nullable(),
  /** Why the last package install failed. */
  depsError: z.string().nullable(),
  /** Packages from package.json or requirements.txt; NONE without one. */
  depsStatus: functionDepsStatusSchema,
  description: z.string().nullable(),
  id: z.string(),
  memoryMb: z.number().int(),
  name: z.string(),
  organizationId: z.string(),
  /** Why the parameters could not be read, e.g. a syntax error. */
  paramsError: z.string().nullable(),
  /** True when the runner could not read the latest source. */
  paramsStale: z.boolean(),
  runtime: functionRuntimeSchema,
  timeoutSeconds: z.number().int(),
  updatedAt: z.date(),
});

export const functionListItemSchema = functionSummarySchema.extend({
  lastRun: z
    .object({ createdAt: z.date(), status: functionRunStatusSchema })
    .nullable(),
});

export const httpTriggerSchema = z.object({
  enabled: z.boolean(),
  /** The token's last four characters, to tell tokens apart. */
  tokenHint: z.string().nullable(),
});

export const functionSchema = functionSummarySchema.extend({
  /** The end of the last package install's output. */
  depsLog: z.string(),
  files: z.array(functionFileSchema),
  httpTrigger: httpTriggerSchema,
  paramsSchema: paramsSchemaSchema.nullable(),
  /** Send back as `baseHash` when saving files. */
  sourceHash: z.string(),
});

export const functionRunSummarySchema = z.object({
  cancelRequestedAt: z.date().nullable(),
  createdAt: z.date(),
  dbCallCount: z.number().int(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  finishedAt: z.date().nullable(),
  functionId: z.string(),
  id: z.string(),
  number: z.number().int(),
  organizationId: z.string(),
  outputTruncated: z.boolean(),
  params: z.record(z.string(), z.unknown()),
  result: z.unknown(),
  scheduleId: z.string().nullable(),
  shopifyCallCount: z.number().int(),
  sourceHash: z.string(),
  startedAt: z.date().nullable(),
  startedByName: z.string().nullable(),
  status: functionRunStatusSchema,
  trigger: functionRunTriggerSchema,
});

export const functionRunSchema = functionRunSummarySchema.extend({
  /** Output after the requested `outputOffset`. */
  output: z.string(),
  /** Length of the whole output; pass it as the next `outputOffset`. */
  outputLength: z.number().int(),
});

export const functionsStatusSchema = z.object({
  /** False while the server has no runner configured. */
  enabled: z.boolean(),
  /** Whether the runner answered just now. */
  reachable: z.boolean(),
  runtimes: z.array(
    z.object({
      id: functionRuntimeSchema,
      label: z.string(),
      ready: z.boolean(),
    })
  ),
});

export const functionEnvVarSchema = z.object({
  name: z.string(),
  updatedAt: z.date(),
});

export const functionGrantKindSchema = z.enum(GRANT_KINDS);

export const functionGrantSchema = z.object({
  alias: z.string(),
  createdAt: z.date(),
  /** The store's domain or the connection's database; null once deleted. */
  detail: z.string().nullable(),
  functionId: z.string(),
  id: z.string(),
  kind: functionGrantKindSchema,
  resourceId: z.string(),
  /** Null once the store or connection was deleted. */
  resourceName: z.string().nullable(),
});

export const functionScheduleSchema = z.object({
  createdAt: z.date(),
  cron: z.string(),
  enabled: z.boolean(),
  functionId: z.string(),
  id: z.string(),
  params: z.record(z.string(), z.unknown()),
  timezone: z.string(),
  updatedAt: z.date(),
});

const cron = z
  .string()
  .trim()
  .refine(
    isCronExpression,
    "Use five cron fields, such as 0 6 * * * for every day at 06:00."
  );
const timezone = z
  .string()
  .refine(isTimeZone, "Use a time zone name such as Asia/Ho_Chi_Minh.");

const functionIdInput = z.object({ functionId: z.string().min(1) });
const scheduleIdInput = z.object({ scheduleId: z.string().min(1) });
const envVarName = z.string().min(1).max(ENV_VAR_LIMITS.nameLength);
const httpTokenOutput = dataEnvelope(
  z.object({
    httpTrigger: httpTriggerSchema,
    /** Shown once; only its hash is stored. */
    token: z.string(),
  })
);
const runIdInput = z.object({ runId: z.string().min(1) });
const functionName = z.string().trim().min(1).max(FUNCTION_LIMITS.nameLength);
const description = z
  .string()
  .max(FUNCTION_LIMITS.descriptionLength)
  .nullable();
const timeoutSeconds = z
  .number()
  .int()
  .min(1)
  .max(FUNCTION_LIMITS.timeoutSeconds);
const memoryMb = z
  .number()
  .int()
  .refine(
    (value) => (FUNCTION_LIMITS.memoryMb as readonly number[]).includes(value),
    `Memory must be one of ${FUNCTION_LIMITS.memoryMb.join(", ")} MB.`
  );

export const functionsContract = {
  addGrant: apiContract
    .route({
      method: "POST",
      operationId: "functions.addGrant",
      path: "/api/functions/{functionId}/grants",
      successStatus: 201,
      summary: "Let a function use a store or database connection",
    })
    .input(
      functionIdInput.extend({
        alias: z
          .string()
          .trim()
          .regex(
            GRANT_ALIAS,
            "Use 1 to 40 lower-case letters, digits and dashes, starting with a letter or digit."
          )
          .optional(),
        kind: functionGrantKindSchema,
        resourceId: z.string().min(1),
      })
    )
    .output(dataEnvelope(functionGrantSchema)),
  create: apiContract
    .route({
      method: "POST",
      operationId: "functions.create",
      path: "/api/organizations/{organizationId}/functions",
      successStatus: 201,
      summary: "Create a function from its runtime's starter files",
    })
    .input(
      organizationIdInput.extend({
        description: description.optional(),
        name: functionName,
        runtime: functionRuntimeSchema,
      })
    )
    .output(dataEnvelope(functionSchema)),
  delete: apiContract
    .route({
      method: "DELETE",
      operationId: "functions.delete",
      path: "/api/functions/{functionId}",
      summary: "Delete a function with its files and runs",
    })
    .input(functionIdInput)
    .output(dataEnvelope(z.object({ id: z.string() }))),
  deleteEnvVar: apiContract
    .route({
      method: "DELETE",
      operationId: "functions.deleteEnvVar",
      path: "/api/functions/{functionId}/env/{name}",
      summary: "Delete a function's variable",
    })
    .input(functionIdInput.extend({ name: envVarName }))
    .output(dataEnvelope(z.object({ name: z.string() }))),
  disableHttpTrigger: apiContract
    .route({
      method: "POST",
      operationId: "functions.disableHttpTrigger",
      path: "/api/functions/{functionId}/http/disable",
      summary: "Turn the HTTP trigger off and forget its token",
    })
    .input(functionIdInput)
    .output(dataEnvelope(httpTriggerSchema)),
  enableHttpTrigger: apiContract
    .route({
      method: "POST",
      operationId: "functions.enableHttpTrigger",
      path: "/api/functions/{functionId}/http/enable",
      summary: "Turn the HTTP trigger on; returns its token once",
    })
    .input(functionIdInput)
    .output(httpTokenOutput),
  get: apiContract
    .route({
      method: "GET",
      operationId: "functions.get",
      path: "/api/functions/{functionId}",
      summary: "Get a function with its files and parameter schema",
    })
    .input(functionIdInput)
    .output(dataEnvelope(functionSchema)),
  list: apiContract
    .route({
      method: "GET",
      operationId: "functions.list",
      path: "/api/organizations/{organizationId}/functions",
      summary: "List an organization's functions",
    })
    .input(organizationIdInput)
    .output(dataEnvelope(z.array(functionListItemSchema))),
  listEnvVars: apiContract
    .route({
      method: "GET",
      operationId: "functions.listEnvVars",
      path: "/api/functions/{functionId}/env",
      summary: "List a function's variable names; values are never returned",
    })
    .input(functionIdInput)
    .output(dataEnvelope(z.array(functionEnvVarSchema))),
  listGrants: apiContract
    .route({
      method: "GET",
      operationId: "functions.listGrants",
      path: "/api/functions/{functionId}/grants",
      summary: "List the stores and databases a function may use",
    })
    .input(functionIdInput)
    .output(dataEnvelope(z.array(functionGrantSchema))),
  reinstallDeps: apiContract
    .route({
      method: "POST",
      operationId: "functions.reinstallDeps",
      path: "/api/functions/{functionId}/deps/rebuild",
      summary: "Install a function's packages again",
    })
    .input(functionIdInput)
    .output(dataEnvelope(functionSchema)),
  removeGrant: apiContract
    .route({
      method: "DELETE",
      operationId: "functions.removeGrant",
      path: "/api/function-grants/{grantId}",
      summary: "Stop a function from using a store or database connection",
    })
    .input(z.object({ grantId: z.string().min(1) }))
    .output(dataEnvelope(z.object({ id: z.string() }))),
  rotateHttpToken: apiContract
    .route({
      method: "POST",
      operationId: "functions.rotateHttpToken",
      path: "/api/functions/{functionId}/http/rotate",
      summary: "Replace the HTTP trigger's token; returns the new one once",
    })
    .input(functionIdInput)
    .output(httpTokenOutput),
  saveFiles: apiContract
    .route({
      method: "PUT",
      operationId: "functions.saveFiles",
      path: "/api/functions/{functionId}/files",
      summary:
        "Replace a function's files; refused when they changed since baseHash",
    })
    .input(
      functionIdInput.extend({
        baseHash: z.string().min(1),
        files: z
          .array(
            z.object({
              content: z.string().max(FUNCTION_LIMITS.fileBytes),
              path: z.string().min(1).max(FUNCTION_LIMITS.pathLength),
            })
          )
          .min(1)
          .max(FUNCTION_LIMITS.files),
      })
    )
    .output(dataEnvelope(functionSchema)),
  setEnvVar: apiContract
    .route({
      method: "PUT",
      operationId: "functions.setEnvVar",
      path: "/api/functions/{functionId}/env/{name}",
      summary: "Create or replace a function's variable",
    })
    .input(
      functionIdInput.extend({
        name: envVarName,
        value: z.string().min(1).max(ENV_VAR_LIMITS.valueBytes),
      })
    )
    .output(dataEnvelope(functionEnvVarSchema)),
  status: apiContract
    .route({
      method: "GET",
      operationId: "functions.status",
      path: "/api/organizations/{organizationId}/functions/status",
      summary: "Whether functions are enabled and the runner is reachable",
    })
    .input(organizationIdInput)
    .output(dataEnvelope(functionsStatusSchema)),
  update: apiContract
    .route({
      method: "PATCH",
      operationId: "functions.update",
      path: "/api/functions/{functionId}",
      summary: "Change a function's name, description or limits",
    })
    .input(
      functionIdInput.extend({
        description: description.optional(),
        memoryMb: memoryMb.optional(),
        name: functionName.optional(),
        timeoutSeconds: timeoutSeconds.optional(),
      })
    )
    .output(dataEnvelope(functionSchema)),
};

export const functionRunsContract = {
  cancel: apiContract
    .route({
      method: "POST",
      operationId: "functionRuns.cancel",
      path: "/api/function-runs/{runId}/cancel",
      summary: "Stop a queued or running run",
    })
    .input(runIdInput)
    .output(dataEnvelope(functionRunSummarySchema)),
  get: apiContract
    .route({
      method: "GET",
      operationId: "functionRuns.get",
      path: "/api/function-runs/{runId}",
      summary: "Get a run with the output after outputOffset",
    })
    .input(
      runIdInput.extend({
        outputOffset: z.coerce.number().int().min(0).default(0),
      })
    )
    .output(dataEnvelope(functionRunSchema)),
  list: apiContract
    .route({
      method: "GET",
      operationId: "functionRuns.list",
      path: "/api/functions/{functionId}/runs",
      summary: "List a function's runs, newest first, without output",
    })
    .input(functionIdInput.extend(cursorPaginationInputSchema.shape))
    .output(paginatedDataEnvelope(functionRunSummarySchema)),
  start: apiContract
    .route({
      method: "POST",
      operationId: "functionRuns.start",
      path: "/api/functions/{functionId}/runs",
      successStatus: 201,
      summary: "Run a function's saved source with parameters",
    })
    .input(
      functionIdInput.extend({
        params: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .output(dataEnvelope(functionRunSummarySchema)),
};

export const functionSchedulesContract = {
  create: apiContract
    .route({
      method: "POST",
      operationId: "functionSchedules.create",
      path: "/api/functions/{functionId}/schedules",
      successStatus: 201,
      summary: "Add a cron schedule that runs the function",
    })
    .input(
      functionIdInput.extend({
        cron,
        enabled: z.boolean().default(true),
        params: z.record(z.string(), z.unknown()).default({}),
        timezone: timezone.default("UTC"),
      })
    )
    .output(dataEnvelope(functionScheduleSchema)),
  delete: apiContract
    .route({
      method: "DELETE",
      operationId: "functionSchedules.delete",
      path: "/api/function-schedules/{scheduleId}",
      summary: "Delete a schedule",
    })
    .input(scheduleIdInput)
    .output(dataEnvelope(z.object({ id: z.string() }))),
  list: apiContract
    .route({
      method: "GET",
      operationId: "functionSchedules.list",
      path: "/api/functions/{functionId}/schedules",
      summary: "List a function's schedules",
    })
    .input(functionIdInput)
    .output(dataEnvelope(z.array(functionScheduleSchema))),
  update: apiContract
    .route({
      method: "PATCH",
      operationId: "functionSchedules.update",
      path: "/api/function-schedules/{scheduleId}",
      summary: "Change a schedule's cron, time zone, parameters or state",
    })
    .input(
      scheduleIdInput.extend({
        cron: cron.optional(),
        enabled: z.boolean().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
        timezone: timezone.optional(),
      })
    )
    .output(dataEnvelope(functionScheduleSchema)),
};
