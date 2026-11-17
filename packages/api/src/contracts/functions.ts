import {
  FUNCTION_LIMITS,
  FUNCTION_RUN_STATUSES,
  FUNCTION_RUNTIMES,
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

export const functionSchema = functionSummarySchema.extend({
  files: z.array(functionFileSchema),
  paramsSchema: paramsSchemaSchema.nullable(),
  /** Send back as `baseHash` when saving files. */
  sourceHash: z.string(),
});

export const functionRunSummarySchema = z.object({
  cancelRequestedAt: z.date().nullable(),
  createdAt: z.date(),
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

const functionIdInput = z.object({ functionId: z.string().min(1) });
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
    .output(dataEnvelope(z.array(functionSummarySchema))),
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
