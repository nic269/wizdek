import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { Actor } from "../../lib/contracts";
import { type Config, getConfig } from "../config";
import { invariant, ManagementError } from "../errors";
import { requireIdentity } from "../identity/wizdek-session";
import { controlStore } from "../storage/control-store";
export interface RequestContext {
  actor: Actor;
  config: Config;
  requestId: string;
}
export function assertOrigin(request: Request, config: Config) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return;
  }
  invariant(
    request.headers.get("origin") === config.publicOrigin &&
      request.headers.get("x-oms-action") === "1",
    "origin_denied",
    "This action must be sent from the management application.",
    403
  );
}
export async function guard(
  request: Request,
  handler: (context: RequestContext) => Promise<Response> | Response
) {
  const requestId = randomUUID();
  const authHeaders = new Headers();
  let actor: Actor | undefined;
  let config: Config | undefined;
  try {
    config = getConfig();
    assertOrigin(request, config);
    actor = await requireIdentity(request, config, authHeaders);
    const response = await handler({ actor, config, requestId });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Request-ID", requestId);
    for (const cookie of authHeaders.getSetCookie()) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch (error) {
    let code = "internal_error";
    let message = "The request could not be completed.";
    let status = 500;
    if (error instanceof ManagementError) {
      ({ code, message, status } = error);
    } else if (error instanceof ZodError) {
      code = "invalid_input";
      message = "Check the supplied values.";
      status = 400;
    }
    if (actor && config && status === 403) {
      try {
        controlStore(config).audit(actor.id, null, null, "access.denied", {
          code,
          method: request.method.slice(0, 16),
          path: new URL(request.url).pathname.slice(0, 256),
          requestId,
        });
      } catch {
        // Audit failure must never replace the original access denial.
      }
    }
    const response = Response.json(
      {
        error: {
          code,
          message,
          requestId,
        },
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-ID": requestId,
        },
        status,
      }
    );
    for (const cookie of authHeaders.getSetCookie()) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  }
}
export async function readBody(
  request: Request,
  maxBytes = 64 * 1024
): Promise<unknown> {
  invariant(
    Number(request.headers.get("content-length") ?? 0) <= maxBytes,
    "body_too_large",
    "Request is too large.",
    413
  );
  const reader = request.body?.getReader();
  if (!reader) {
    return {};
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) {
      break;
    }
    length += item.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new ManagementError("body_too_large", "Request is too large.", 413);
    }
    chunks.push(item.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ManagementError(
      "invalid_json",
      "Request must contain valid JSON."
    );
  }
}
