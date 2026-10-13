import { prisma } from "@repo/database";
import {
  builtInRegistry,
  cancelFlowRun,
  createFlow,
  type FlowRecord,
  type FlowRunRecord,
  type FlowVersionRecord,
  flowDefinitionSchema,
  getFlow,
  getFlowRun,
  listFlowRunItems,
  listFlowRuns,
  listFlows,
  readDefinition,
  saveFlowVersion,
  startFlowRun,
  updateFlow,
  validateDefinition,
} from "@repo/flows";
import { ApiError } from "../errors";
import { getJobProvider } from "../jobs";
import {
  requireFlowPermission,
  requireOrganizationAccess,
  requireRunPermission,
} from "./authz";
import { withFlowErrors } from "./flow-errors";
import { os } from "./implementer";

const toPublicFlow = (flow: FlowRecord) => ({
  createdAt: flow.createdAt,
  currentVersionId: flow.currentVersionId,
  description: flow.description,
  id: flow.id,
  name: flow.name,
  organizationId: flow.organizationId,
  status: flow.status,
  updatedAt: flow.updatedAt,
});

const toPublicVersion = (version: FlowVersionRecord) => ({
  createdAt: version.createdAt,
  definition: version.definition,
  id: version.id,
  version: version.version,
});

const toPublicRun = (run: FlowRunRecord) => ({
  cancelRequestedAt: run.cancelRequestedAt,
  completedAt: run.completedAt,
  createdAt: run.createdAt,
  error: run.error,
  flowId: run.flowId,
  flowVersionId: run.flowVersionId,
  id: run.id,
  itemCount: run.itemCount,
  organizationId: run.organizationId,
  startedAt: run.startedAt,
  startedById: run.startedById,
  status: run.status,
  storeId: run.storeId,
  triggerType: run.triggerType,
});

const scopeOf = (flow: FlowRecord) => ({
  flowId: flow.id,
  organizationId: flow.organizationId,
});

const runScopeOf = (run: FlowRunRecord) => ({
  organizationId: run.organizationId,
  runId: run.id,
});

const runsRouter = {
  cancel: os.flows.runs.cancel.handler(async ({ context, input }) => {
    const { run } = await requireRunPermission(
      context.headers,
      input.runId,
      "run"
    );
    return {
      data: toPublicRun(
        await withFlowErrors(() => cancelFlowRun(runScopeOf(run)))
      ),
    };
  }),
  get: os.flows.runs.get.handler(async ({ context, input }) => {
    const { run } = await requireRunPermission(
      context.headers,
      input.runId,
      "read"
    );
    const [detail, version] = await Promise.all([
      withFlowErrors(() => getFlowRun(runScopeOf(run))),
      prisma.flowVersion.findUniqueOrThrow({
        where: { id: run.flowVersionId },
      }),
    ]);
    return {
      data: {
        nodes: Object.fromEntries(
          Object.entries(detail.nodes).map(([nodeId, { counts, step }]) => [
            nodeId,
            {
              counts,
              step: step && {
                completedAt: step.completedAt,
                error: step.error,
                startedAt: step.startedAt,
                status: step.status,
              },
            },
          ])
        ),
        run: toPublicRun(detail.run),
        version: toPublicVersion(version),
      },
    };
  }),
  items: {
    list: os.flows.runs.items.list.handler(async ({ context, input }) => {
      const { run } = await requireRunPermission(
        context.headers,
        input.runId,
        "read"
      );
      const page = await withFlowErrors(() =>
        listFlowRunItems(runScopeOf(run), {
          cursor: input.cursor,
          limit: input.limit,
          nodeId: input.nodeId,
          status: input.status,
        })
      );
      return {
        data: page.items.map((item) => ({
          attempts: item.attempts,
          durationMs: item.durationMs,
          error: item.error,
          id: item.id,
          input: item.input,
          itemKey: item.itemKey,
          nodeId: item.nodeId,
          output: item.output,
          outputHandle: item.outputHandle,
          status: item.status,
          updatedAt: item.updatedAt,
        })),
        pageInfo: { nextCursor: page.nextCursor },
      };
    }),
  },
  list: os.flows.runs.list.handler(async ({ context, input }) => {
    const { flow } = await requireFlowPermission(
      context.headers,
      input.flowId,
      "read"
    );
    const page = await listFlowRuns(scopeOf(flow), {
      cursor: input.cursor,
      limit: input.limit,
    });
    return {
      data: page.items.map(toPublicRun),
      pageInfo: { nextCursor: page.nextCursor },
    };
  }),
  start: os.flows.runs.start.handler(async ({ context, input }) => {
    const { flow, user } = await requireFlowPermission(
      context.headers,
      input.flowId,
      "run"
    );
    const run = await withFlowErrors(() =>
      startFlowRun(
        scopeOf(flow),
        { actorId: user.id, inputs: input.inputs, storeId: input.storeId },
        { jobs: getJobProvider() }
      )
    );
    return { data: toPublicRun(run) };
  }),
};

/** Reads a definition sent by a client, which may be any JSON. */
const parseDefinition = (definition: unknown) => {
  const parsed = flowDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `The flow definition is malformed: ${parsed.error.issues[0]?.message ?? "invalid data"}.`,
      422,
      { reason: "DEFINITION_INVALID" }
    );
  }
  return parsed.data;
};

export const flowsRouter = {
  create: os.flows.create.handler(async ({ context, input }) => {
    const user = await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "flows",
      "manage"
    );
    const { flow, version } = await createFlow({
      actorId: user.id,
      description: input.description,
      name: input.name,
      organizationId: input.organizationId,
    });
    if (!version) {
      throw new ApiError("INTERNAL_SERVER_ERROR", "Flow version missing.", 500);
    }
    return {
      data: { flow: toPublicFlow(flow), version: toPublicVersion(version) },
    };
  }),
  get: os.flows.get.handler(async ({ context, input }) => {
    const authorized = await requireFlowPermission(
      context.headers,
      input.flowId,
      "read"
    );
    const { flow, version } = await withFlowErrors(() =>
      getFlow(scopeOf(authorized.flow))
    );
    return {
      data: {
        flow: toPublicFlow(flow),
        validation: version
          ? validateDefinition(readDefinition(version))
          : { issues: [], valid: false },
        version: version && toPublicVersion(version),
      },
    };
  }),
  list: os.flows.list.handler(async ({ context, input }) => {
    await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "flows",
      "read"
    );
    const flows = await listFlows(input.organizationId);
    return {
      data: flows.map((flow) => ({
        ...toPublicFlow(flow),
        lastRun: flow.lastRun && {
          ...flow.lastRun,
          status: flow.lastRun.status as FlowRunRecord["status"],
        },
      })),
    };
  }),
  nodeTypes: os.flows.nodeTypes.handler(async ({ context, input }) => {
    await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "flows",
      "read"
    );
    return {
      data: builtInRegistry.metadata().map((nodeType) => ({
        ...nodeType,
        outputs: nodeType.outputs && [...nodeType.outputs],
      })),
    };
  }),
  runs: runsRouter,
  saveVersion: os.flows.saveVersion.handler(async ({ context, input }) => {
    const { flow, user } = await requireFlowPermission(
      context.headers,
      input.flowId,
      "manage"
    );
    const saved = await withFlowErrors(() =>
      saveFlowVersion(scopeOf(flow), {
        actorId: user.id,
        baseVersion: input.baseVersion,
        definition: input.definition,
      })
    );
    return {
      data: {
        flow: toPublicFlow(saved.flow),
        validation: saved.validation,
        version: toPublicVersion(saved.version),
      },
    };
  }),
  update: os.flows.update.handler(async ({ context, input }) => {
    const { flow } = await requireFlowPermission(
      context.headers,
      input.flowId,
      "manage"
    );
    const { flowId: _flowId, ...changes } = input;
    return {
      data: toPublicFlow(
        await withFlowErrors(() => updateFlow(scopeOf(flow), changes))
      ),
    };
  }),
  validate: os.flows.validate.handler(async ({ context, input }) => {
    await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "flows",
      "manage"
    );
    return { data: validateDefinition(parseDefinition(input.definition)) };
  }),
};
