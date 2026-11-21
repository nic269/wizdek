import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@repo/database";
import { recordFunctionAudit } from "../audit";
import { HTTP_TRIGGER } from "../definition";
import { RUNNER_BUSY_MESSAGE } from "../runner/client";
import type { CodeFunctionRecord, FunctionScope } from "./functions";
import { getFunction } from "./functions";
import {
  type CodeFunctionRunRecord,
  getRun,
  type RunTrigger,
  startRun,
} from "./runs";

const TOKEN_BYTES = 32;
const HINT_LENGTH = 4;

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const newToken = () =>
  `${HTTP_TRIGGER.tokenPrefix}${randomBytes(TOKEN_BYTES).toString("base64url")}`;

/** How the trigger stands, without the token. */
export interface HttpTriggerState {
  enabled: boolean;
  tokenHint: string | null;
}

export const httpTriggerStateOf = (
  fn: Pick<CodeFunctionRecord, "httpTokenHash" | "httpTokenHint">
): HttpTriggerState => ({
  enabled: fn.httpTokenHash !== null,
  tokenHint: fn.httpTokenHash ? fn.httpTokenHint : null,
});

const storeToken = async (
  input: FunctionScope & { actorId: string },
  action: "function.http.enabled" | "function.http.rotated"
): Promise<{ state: HttpTriggerState; token: string }> => {
  const fn = await getFunction(input);
  const token = newToken();
  const updated = await prisma.$transaction(async (db) => {
    const saved = await db.codeFunction.update({
      data: {
        httpTokenHash: hashToken(token),
        httpTokenHint: token.slice(-HINT_LENGTH),
      },
      where: { id: fn.id },
    });
    await recordFunctionAudit(db, {
      action,
      actorId: input.actorId,
      metadata: { name: fn.name },
      organizationId: fn.organizationId,
      targetId: fn.id,
      targetType: "CodeFunction",
    });
    return saved;
  });
  return { state: httpTriggerStateOf(updated), token };
};

/**
 * Turns the HTTP trigger on, or replaces its token when it is on. The token
 * is returned this once; only its hash is kept.
 */
export const enableHttpTrigger = async (
  input: FunctionScope & { actorId: string }
) => {
  const fn = await getFunction(input);
  return storeToken(
    input,
    fn.httpTokenHash ? "function.http.rotated" : "function.http.enabled"
  );
};

export const rotateHttpToken = (input: FunctionScope & { actorId: string }) =>
  storeToken(input, "function.http.rotated");

export const disableHttpTrigger = async (
  input: FunctionScope & { actorId: string }
): Promise<HttpTriggerState> => {
  const fn = await getFunction(input);
  const updated = await prisma.$transaction(async (db) => {
    const saved = await db.codeFunction.update({
      data: { httpTokenHash: null, httpTokenHint: null },
      where: { id: fn.id },
    });
    await recordFunctionAudit(db, {
      action: "function.http.disabled",
      actorId: input.actorId,
      metadata: { name: fn.name },
      organizationId: fn.organizationId,
      targetId: fn.id,
      targetType: "CodeFunction",
    });
    return saved;
  });
  return httpTriggerStateOf(updated);
};

/**
 * The function a trigger call may run, or null when the id is unknown, the
 * trigger is off or the token is wrong. The caller answers all three alike.
 */
export const authenticateTrigger = async (
  functionId: string,
  token: string | null
): Promise<CodeFunctionRecord | null> => {
  if (!(functionId && token)) {
    return null;
  }
  const fn = await prisma.codeFunction.findUnique({
    where: { id: functionId },
  });
  if (!fn?.httpTokenHash) {
    return null;
  }
  const expected = Buffer.from(fn.httpTokenHash, "hex");
  const given = Buffer.from(hashToken(token), "hex");
  return timingSafeEqual(expected, given) ? fn : null;
};

export type TriggerOutcome =
  | { kind: "finished"; run: CodeFunctionRunRecord }
  | { kind: "pending"; run: CodeFunctionRunRecord }
  | { kind: "busy"; run: CodeFunctionRunRecord };

/**
 * Starts a run and waits up to `waitMs` for it. A run the runner refused for
 * lack of room is reported as busy, so the caller can ask to retry.
 */
export const invokeFunction = async (
  fn: CodeFunctionRecord,
  params: Record<string, unknown>,
  options: { trigger?: RunTrigger; waitMs?: number } = {}
): Promise<TriggerOutcome> => {
  const { completion, run } = await startRun({
    functionId: fn.id,
    organizationId: fn.organizationId,
    params,
    trigger: options.trigger ?? "HTTP",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = await Promise.race([
    completion,
    new Promise<null>((resolve) => {
      timer = setTimeout(
        () => resolve(null),
        options.waitMs ?? HTTP_TRIGGER.waitMs
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (!waited) {
    completion.catch((error: unknown) => {
      console.error("functions.run_failed", error);
    });
    return { kind: "pending", run };
  }
  if (waited.status === "FAILED" && waited.error === RUNNER_BUSY_MESSAGE) {
    return { kind: "busy", run: waited };
  }
  return { kind: "finished", run: waited };
};

/** A run started through this function's trigger, for its status route. */
export const getTriggeredRun = async (
  fn: CodeFunctionRecord,
  runId: string
): Promise<CodeFunctionRunRecord | null> => {
  try {
    const run = await getRun({ organizationId: fn.organizationId, runId });
    return run.functionId === fn.id ? run : null;
  } catch {
    return null;
  }
};
