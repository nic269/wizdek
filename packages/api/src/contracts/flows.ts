import { z } from "zod";
import {
  apiContract,
  cursorPaginationInputSchema,
  dataEnvelope,
  paginatedDataEnvelope,
} from "./base";
import { organizationIdInput, targetEnvironmentSchema } from "./shopify-shared";

export const flowStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export const flowRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "PARTIALLY_FAILED",
  "FAILED",
  "CANCELED",
]);
export const flowStepStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
]);
export const flowItemStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
]);

/**
 * The stored definition is returned as it was saved. Its exact shape is
 * owned by `@repo/flows/definition`, which the canvas uses to read it.
 */
const definitionSchema = z.unknown();

export const flowSchema = z.object({
  createdAt: z.date(),
  currentVersionId: z.string().nullable(),
  description: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  organizationId: z.string(),
  status: flowStatusSchema,
  updatedAt: z.date(),
});

export const flowVersionSchema = z.object({
  createdAt: z.date(),
  definition: definitionSchema,
  id: z.string(),
  version: z.number().int(),
});

export const flowIssueSchema = z.object({
  code: z.string(),
  edgeId: z.string().optional(),
  message: z.string(),
  nodeId: z.string().optional(),
  path: z.string().optional(),
});

export const flowValidationSchema = z.object({
  issues: z.array(flowIssueSchema),
  valid: z.boolean(),
});

export const flowNodeTypeSchema = z.object({
  category: z.enum(["trigger", "data", "logic", "action"]),
  configSchema: z.unknown(),
  description: z.string(),
  idempotent: z.boolean().nullable(),
  label: z.string(),
  mode: z.enum(["item", "batch"]),
  outputs: z.array(z.string()).nullable(),
  type: z.string(),
});

export const flowRunSchema = z.object({
  cancelRequestedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  error: z.unknown(),
  flowId: z.string(),
  flowVersionId: z.string(),
  id: z.string(),
  itemCount: z.number().int(),
  /** Counts the flow's runs from 1. */
  number: z.number().int(),
  organizationId: z.string(),
  startedAt: z.date().nullable(),
  startedById: z.string().nullable(),
  status: flowRunStatusSchema,
  storeId: z.string(),
  triggerType: z.string(),
});

export const flowRunListItemSchema = flowRunSchema.extend({
  flowName: z.string(),
  /** Items of the run in each status, across all nodes. */
  itemCounts: z.record(z.string(), z.number().int()),
  startedByName: z.string().nullable(),
  storeDomain: z.string(),
  storeEnvironment: targetEnvironmentSchema,
  storeName: z.string(),
});

export const flowVersionListItemSchema = z.object({
  createdAt: z.date(),
  createdByName: z.string().nullable(),
  id: z.string(),
  version: z.number().int(),
});

export const flowRunNodeSchema = z.object({
  /** How many of the node's items are in each status. */
  counts: z.record(z.string(), z.number().int()),
  /** How many items the node sent out of each output handle. */
  emitted: z.record(z.string(), z.number().int()),
  step: z
    .object({
      completedAt: z.date().nullable(),
      error: z.unknown(),
      startedAt: z.date().nullable(),
      status: flowStepStatusSchema,
    })
    .nullable(),
});

export const flowRunItemSchema = z.object({
  attempts: z.number().int(),
  durationMs: z.number().int().nullable(),
  error: z.unknown(),
  id: z.string(),
  input: z.unknown(),
  itemKey: z.string(),
  nodeId: z.string(),
  output: z.unknown(),
  outputHandle: z.string().nullable(),
  status: flowItemStatusSchema,
  updatedAt: z.date(),
});

export const flowActivationSchema = z.object({
  createdAt: z.date(),
  /** Why activation failed, or what could not be cleaned up. */
  error: z.string().nullable(),
  flowVersionId: z.string(),
  id: z.string(),
  status: z.enum(["ACTIVE", "FAILED", "INACTIVE"]),
  storeId: z.string(),
  storeName: z.string(),
  updatedAt: z.date(),
});

const flowIdInput = z.object({ flowId: z.string().min(1) });
const runIdInput = z.object({ runId: z.string().min(1) });
const nameSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().trim().max(500);
const definitionInput = z.record(z.string(), z.unknown());

const activationInput = flowIdInput.extend({ storeId: z.string().min(1) });

const activationsContract = {
  activate: apiContract
    .route({
      method: "POST",
      operationId: "flows.activations.activate",
      path: "/api/flows/{flowId}/activations",
      summary: "Turn a webhook or scheduled flow on for a store",
    })
    .input(activationInput)
    .output(dataEnvelope(flowActivationSchema)),
  deactivate: apiContract
    .route({
      method: "DELETE",
      operationId: "flows.activations.deactivate",
      path: "/api/flows/{flowId}/activations/{storeId}",
      summary: "Turn a flow off for a store",
    })
    .input(activationInput)
    .output(dataEnvelope(flowActivationSchema.nullable())),
  list: apiContract
    .route({
      method: "GET",
      operationId: "flows.activations.list",
      path: "/api/flows/{flowId}/activations",
      summary: "List the stores a flow is activated on",
    })
    .input(flowIdInput)
    .output(dataEnvelope(z.array(flowActivationSchema))),
};

export const flowsContract = {
  activations: activationsContract,
  create: apiContract
    .route({
      method: "POST",
      operationId: "flows.create",
      path: "/api/organizations/{organizationId}/flows",
      successStatus: 201,
      summary: "Create a flow with an empty first version",
    })
    .input(
      organizationIdInput.extend({
        description: descriptionSchema.optional(),
        name: nameSchema,
      })
    )
    .output(
      dataEnvelope(z.object({ flow: flowSchema, version: flowVersionSchema }))
    ),
  get: apiContract
    .route({
      method: "GET",
      operationId: "flows.get",
      path: "/api/flows/{flowId}",
      summary: "Get a flow with its current version",
    })
    .input(flowIdInput)
    .output(
      dataEnvelope(
        z.object({
          flow: flowSchema,
          validation: flowValidationSchema,
          version: flowVersionSchema.nullable(),
        })
      )
    ),
  list: apiContract
    .route({
      method: "GET",
      operationId: "flows.list",
      path: "/api/organizations/{organizationId}/flows",
      summary: "List an organization's flows",
    })
    .input(organizationIdInput)
    .output(
      dataEnvelope(
        z.array(
          flowSchema.extend({
            lastRun: z
              .object({
                createdAt: z.date(),
                id: z.string(),
                number: z.number().int(),
                status: flowRunStatusSchema,
                storeName: z.string(),
              })
              .nullable(),
            /** Steps in the current version, the trigger included. */
            stepCount: z.number().int(),
            triggerType: z.string().nullable(),
            version: z.number().int().nullable(),
          })
        )
      )
    ),
  nodeTypes: apiContract
    .route({
      method: "GET",
      operationId: "flows.nodeTypes",
      path: "/api/organizations/{organizationId}/flows/node-types",
      summary: "List the node types a flow can use",
    })
    .input(organizationIdInput)
    .output(dataEnvelope(z.array(flowNodeTypeSchema))),
  runs: {
    cancel: apiContract
      .route({
        method: "POST",
        operationId: "flows.runs.cancel",
        path: "/api/flow-runs/{runId}/cancel",
        summary: "Ask a run to stop after the item it is processing",
      })
      .input(runIdInput)
      .output(dataEnvelope(flowRunSchema)),
    get: apiContract
      .route({
        method: "GET",
        operationId: "flows.runs.get",
        path: "/api/flow-runs/{runId}",
        summary: "Get a run with per-node progress",
      })
      .input(runIdInput)
      .output(
        dataEnvelope(
          z.object({
            flowName: z.string(),
            nodes: z.record(z.string(), flowRunNodeSchema),
            run: flowRunSchema,
            startedByName: z.string().nullable(),
            store: z.object({
              environment: targetEnvironmentSchema,
              name: z.string(),
              shopDomain: z.string(),
            }),
            version: flowVersionSchema,
          })
        )
      ),
    items: {
      list: apiContract
        .route({
          method: "GET",
          operationId: "flows.runs.items.list",
          path: "/api/flow-runs/{runId}/items",
          summary: "List a run's items, optionally for one node or status",
        })
        .input(
          runIdInput.extend({
            ...cursorPaginationInputSchema.shape,
            nodeId: z.string().min(1).optional(),
            status: flowItemStatusSchema.optional(),
          })
        )
        .output(paginatedDataEnvelope(flowRunItemSchema)),
    },
    list: apiContract
      .route({
        method: "GET",
        operationId: "flows.runs.list",
        path: "/api/flows/{flowId}/runs",
        summary: "List a flow's runs, newest first",
      })
      .input(flowIdInput.extend(cursorPaginationInputSchema.shape))
      .output(paginatedDataEnvelope(flowRunListItemSchema)),
    listForOrganization: apiContract
      .route({
        method: "GET",
        operationId: "flows.runs.listForOrganization",
        path: "/api/organizations/{organizationId}/flow-runs",
        summary: "List the organization's runs across flows, newest first",
      })
      .input(organizationIdInput.extend(cursorPaginationInputSchema.shape))
      .output(paginatedDataEnvelope(flowRunListItemSchema)),
    start: apiContract
      .route({
        method: "POST",
        operationId: "flows.runs.start",
        path: "/api/flows/{flowId}/runs",
        successStatus: 201,
        summary: "Start a run of the flow's current version against a store",
      })
      .input(
        flowIdInput.extend({
          inputs: z.record(z.string(), z.unknown()).optional(),
          storeId: z.string().min(1),
        })
      )
      .output(dataEnvelope(flowRunSchema)),
  },
  saveVersion: apiContract
    .route({
      method: "POST",
      operationId: "flows.saveVersion",
      path: "/api/flows/{flowId}/versions",
      successStatus: 201,
      summary: "Save the definition as a new version",
    })
    .input(
      flowIdInput.extend({
        /** The version the editor loaded; a stale value answers 409. */
        baseVersion: z.number().int().min(0),
        definition: definitionInput,
      })
    )
    .output(
      dataEnvelope(
        z.object({
          flow: flowSchema,
          validation: flowValidationSchema,
          version: flowVersionSchema,
        })
      )
    ),
  update: apiContract
    .route({
      method: "PATCH",
      operationId: "flows.update",
      path: "/api/flows/{flowId}",
      summary: "Rename a flow, change its description or its status",
    })
    .input(
      flowIdInput.extend({
        description: descriptionSchema.nullable().optional(),
        name: nameSchema.optional(),
        status: flowStatusSchema.optional(),
      })
    )
    .output(dataEnvelope(flowSchema)),
  validate: apiContract
    .route({
      method: "POST",
      operationId: "flows.validate",
      path: "/api/organizations/{organizationId}/flows/validate",
      summary: "Check a definition without saving it",
    })
    .input(organizationIdInput.extend({ definition: definitionInput }))
    .output(dataEnvelope(flowValidationSchema)),
  versions: apiContract
    .route({
      method: "GET",
      operationId: "flows.versions",
      path: "/api/flows/{flowId}/versions",
      summary: "List a flow's saved versions, newest first",
    })
    .input(flowIdInput)
    .output(dataEnvelope(z.array(flowVersionListItemSchema))),
};
