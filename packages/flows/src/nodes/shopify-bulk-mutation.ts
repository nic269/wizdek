import { MAIN_OUTPUT } from "../definition/node-spec";
import {
  MAX_BULK_FILE_BYTES,
  shopifyBulkMutationSpec,
} from "../definition/specs/shopify-bulk-mutation";
import {
  defineBatchNode,
  FlowFatalError,
  type FlowItem,
  type NodeBatchItemResult,
  type NodeContext,
} from "../registry/define-node";

const STAGED_UPLOAD_MUTATION = `mutation FlowBulkStagedUpload($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url parameters { name value } }
    userErrors { field message }
  }
}`;

const RUN_MUTATION = `mutation FlowBulkRun($mutation: String!, $stagedUploadPath: String!) {
  bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`;

const POLL_QUERY = `query FlowBulkStatus($id: ID!) {
  bulkOperation(id: $id) { id status errorCode objectCount url partialDataUrl }
}`;

const STATE_KEY = "bulkOperation";
const USER_ERRORS_KEY = /(^u|U)serErrors$/;
const FINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELED", "EXPIRED"]);

/**
 * What the node remembers between restarts. `submitting` is written before
 * the operation is started and `submitted` after, so a restart can tell
 * "never started", "started, id known" and "cannot tell" apart.
 */
interface BulkState {
  /** Item keys in the order of the uploaded lines. */
  keys: string[];
  operationId?: string;
  phase: "submitting" | "submitted";
}

interface UserError {
  field: string[] | null;
  message: string;
}

interface BulkOperationStatus {
  errorCode: string | null;
  status: string;
  url: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sleep = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });

const resolveDeep = (
  value: unknown,
  ctx: NodeContext,
  item: FlowItem
): unknown => {
  if (typeof value === "string") {
    return ctx.resolve(value, item);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveDeep(entry, ctx, item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveDeep(entry, ctx, item),
      ])
    );
  }
  return value;
};

const failOnUserErrors = (errors: UserError[] | undefined, action: string) => {
  if (errors && errors.length > 0) {
    throw new FlowFatalError(
      `Shopify refused to ${action}: ${errors.map(({ message }) => message).join("; ")}`
    );
  }
};

/** Uploads the variables file and starts the operation. Returns its id. */
const submit = async (
  ctx: NodeContext,
  mutation: string,
  jsonl: string
): Promise<string> => {
  const staged = await ctx.shopify.request<{
    stagedUploadsCreate: {
      stagedTargets: {
        parameters: { name: string; value: string }[];
        url: string;
      }[];
      userErrors: UserError[];
    };
  }>(STAGED_UPLOAD_MUTATION, {
    input: [
      {
        filename: "bulk-variables.jsonl",
        httpMethod: "POST",
        mimeType: "text/jsonl",
        resource: "BULK_MUTATION_VARIABLES",
      },
    ],
  });
  failOnUserErrors(staged.stagedUploadsCreate.userErrors, "accept the upload");
  const [target] = staged.stagedUploadsCreate.stagedTargets;
  const stagedUploadPath = target?.parameters.find(
    ({ name }) => name === "key"
  )?.value;
  if (!(target && stagedUploadPath)) {
    throw new FlowFatalError("Shopify did not return an upload location.");
  }

  // Shopify requires the file to be the last field of the form.
  const form = new FormData();
  for (const { name, value } of target.parameters) {
    form.set(name, value);
  }
  form.set(
    "file",
    new Blob([jsonl], { type: "text/jsonl" }),
    "bulk-variables.jsonl"
  );
  const upload = await fetch(target.url, {
    body: form,
    method: "POST",
    signal: ctx.signal,
  });
  if (!upload.ok) {
    throw new FlowFatalError(
      `Uploading the batch failed with HTTP ${upload.status}.`
    );
  }

  const started = await ctx.shopify.request<{
    bulkOperationRunMutation: {
      bulkOperation: { id: string } | null;
      userErrors: UserError[];
    };
  }>(RUN_MUTATION, { mutation, stagedUploadPath });
  failOnUserErrors(
    started.bulkOperationRunMutation.userErrors,
    "start the bulk operation"
  );
  const id = started.bulkOperationRunMutation.bulkOperation?.id;
  if (!id) {
    throw new FlowFatalError("Shopify did not start the bulk operation.");
  }
  return id;
};

const waitUntilFinal = async (
  ctx: NodeContext,
  operationId: string,
  pollIntervalSeconds: number
): Promise<BulkOperationStatus> => {
  for (;;) {
    const data = await ctx.shopify.request<{
      bulkOperation: BulkOperationStatus | null;
    }>(POLL_QUERY, { id: operationId });
    if (!data.bulkOperation) {
      throw new FlowFatalError("Shopify no longer knows this bulk operation.");
    }
    if (FINAL_STATUSES.has(data.bulkOperation.status)) {
      return data.bulkOperation;
    }
    await sleep(pollIntervalSeconds * 1000, ctx.signal);
  }
};

const describeLine = (line: Record<string, unknown>): string | null => {
  if (Array.isArray(line.errors) && line.errors.length > 0) {
    return line.errors
      .map((error) => (isRecord(error) ? String(error.message) : String(error)))
      .join("; ");
  }
  const messages = Object.values(isRecord(line.data) ? line.data : {})
    .filter(isRecord)
    .flatMap((payload) => Object.entries(payload))
    .filter(
      ([key, errors]) => USER_ERRORS_KEY.test(key) && Array.isArray(errors)
    )
    .flatMap(([, errors]) => errors as unknown[])
    .filter(isRecord)
    .map((error) => String(error.message));
  return messages.length > 0 ? messages.join("; ") : null;
};

/** Reads the result file: one line per input line, tagged with its number. */
const readResults = async (
  ctx: NodeContext,
  url: string,
  items: Map<string, FlowItem>,
  keys: string[]
): Promise<NodeBatchItemResult[]> => {
  const response = await fetch(url, { signal: ctx.signal });
  if (!response.ok) {
    throw new FlowFatalError(
      `Reading the bulk operation's results failed with HTTP ${response.status}.`
    );
  }
  const byLine = new Map<number, Record<string, unknown>>();
  for (const text of (await response.text()).split("\n")) {
    if (!text.trim()) {
      continue;
    }
    const line = JSON.parse(text) as Record<string, unknown>;
    byLine.set(Number(line.__lineNumber), line);
  }
  return keys.map((key, index): NodeBatchItemResult => {
    const line = byLine.get(index);
    const item = items.get(key);
    if (!(line && item)) {
      return {
        error: "The bulk operation returned no result for this item.",
        key,
        uncertain: true,
      };
    }
    const error = describeLine(line);
    return error
      ? { error, key }
      : {
          key,
          outputs: [
            { handle: MAIN_OUTPUT, json: { ...item.json, result: line.data } },
          ],
        };
  });
};

const allUncertain = (keys: string[], error: string): NodeBatchItemResult[] =>
  keys.map((key) => ({ error, key, uncertain: true }));

/**
 * Sends every item to Shopify as one bulk operation: build a JSONL file of
 * variables, upload it, start the operation, wait for it, and match each
 * result line back to its item. The operation id is saved before waiting,
 * so a restart resumes waiting instead of submitting the batch again.
 */
export const shopifyBulkMutationNode = defineBatchNode(
  shopifyBulkMutationSpec,
  async ({ config, ctx, items }) => {
    const byKey = new Map(items.map((item) => [item.key, item]));
    let state = await ctx.stepState.get<BulkState>(STATE_KEY);

    if (state?.phase === "submitting") {
      // The process stopped between starting the operation and saving its
      // id. Submitting again could apply every change twice.
      return {
        results: allUncertain(
          state.keys,
          "The run was interrupted while the batch was being submitted, so its outcome is unknown. Check the store before repeating it."
        ),
      };
    }

    if (!state) {
      const template: unknown = JSON.parse(config.variables);
      const jsonl = `${items
        .map((item) => JSON.stringify(resolveDeep(template, ctx, item)))
        .join("\n")}\n`;
      if (Buffer.byteLength(jsonl) > MAX_BULK_FILE_BYTES) {
        throw new FlowFatalError(
          "The batch is larger than Shopify's 100 MB limit for a bulk operation. Split the input into smaller runs."
        );
      }
      const keys = items.map(({ key }) => key);
      await ctx.stepState.set(STATE_KEY, { keys, phase: "submitting" });
      let operationId: string;
      try {
        operationId = await submit(ctx, config.mutation, jsonl);
      } catch (error) {
        if (error instanceof FlowFatalError) {
          // Refused before anything started, so trying again is safe.
          await ctx.stepState.set(STATE_KEY, null);
        }
        throw error;
      }
      state = { keys, operationId, phase: "submitted" };
      await ctx.stepState.set(STATE_KEY, state);
      ctx.logger.info("flow.bulk_operation_started", { operationId });
    }

    const operation = await waitUntilFinal(
      ctx,
      state.operationId as string,
      config.pollIntervalSeconds
    );
    if (operation.status !== "COMPLETED" || !operation.url) {
      return {
        results: allUncertain(
          state.keys,
          `The bulk operation ended as ${operation.status}${
            operation.errorCode ? ` (${operation.errorCode})` : ""
          }. Some items may have been applied; check the store.`
        ),
      };
    }
    return {
      results: await readResults(ctx, operation.url, byKey, state.keys),
    };
  }
);
