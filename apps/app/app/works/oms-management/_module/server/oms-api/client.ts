import { createHash } from "node:crypto";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Config } from "../config";
import { invariant, ManagementError } from "../errors";
import { validateNetwork } from "../profiles/network-policy";
import type { Connection } from "../profiles/schema";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const databaseFingerprint = (connection: Connection) =>
  fingerprint({
    database: connection.database.name,
    host: connection.database.host.toLowerCase(),
    port: connection.database.port,
  });
export function pinnedLookup(address: {
  address: string;
  family: number;
}): NonNullable<RequestOptions["lookup"]> {
  return (_hostname, options, callback) => {
    // Node's automatic family selection requests an array; keep it pinned to one validated IP.
    if (options.all) {
      callback(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };
}
function rejection(status: number | undefined) {
  const definitive =
    typeof status === "number" && status >= 400 && status < 500;
  return new ManagementError(
    definitive ? "bridge_rejected_definitive" : "bridge_rejected",
    "OMS rejected the request. Check the record version, API connection and token.",
    definitive ? status : 502
  );
}
export async function bridgeRequest(
  connection: Connection,
  config: Config,
  path:
    | "identity"
    | "catalog"
    | "commands"
    | "status"
    | "preview"
    | "reveal"
    | "download",
  body?: unknown
): Promise<unknown> {
  invariant(
    connection.api,
    "api_required",
    "This connection has no OMS API.",
    409
  );
  const { api } = connection;
  const pinned = await validateNetwork(connection, config);
  const apiAddress = pinned.api;
  invariant(apiAddress, "api_required", "No API endpoint is available.", 409);
  const url = new URL(`/api/v1/management/${path}`, api.origin);
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${api.token}`,
          "content-type": "application/json",
          "x-oms-database-fingerprint": databaseFingerprint(connection),
          ...(api.databaseIdentity
            ? { "x-oms-database-id": api.databaseIdentity }
            : {}),
          ...(api.deploymentId
            ? { "x-oms-deployment-id": api.deploymentId }
            : {}),
          ...(serialized
            ? { "content-length": Buffer.byteLength(serialized) }
            : {}),
        },
        lookup: pinnedLookup(apiAddress),
        method: serialized ? "POST" : "GET",
        timeout: 10_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > (path === "download" ? 50 : 2) * 1024 * 1024) {
            response.destroy();
            reject(
              new ManagementError(
                "bridge_response_limit",
                "OMS response exceeded the limit.",
                502
              )
            );
          } else {
            chunks.push(chunk);
          }
        });
        response.on("error", () =>
          reject(
            new ManagementError(
              "bridge_unavailable",
              "OMS API could not be reached.",
              502
            )
          )
        );
        response.on("end", () => {
          if (response.statusCode === 404 && path === "status") {
            resolve({ status: "unknown" });
            return;
          }
          if (
            !response.statusCode ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            reject(rejection(response.statusCode));
            return;
          }
          if (path === "download") {
            resolve({
              content: Buffer.concat(chunks),
              contentType:
                response.headers["content-type"] ?? "application/octet-stream",
              disposition:
                response.headers["content-disposition"] ??
                'attachment; filename="oms-document"',
            });
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(
              new ManagementError(
                "bridge_invalid",
                "OMS API returned an invalid response.",
                502
              )
            );
          }
        });
      }
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () =>
      reject(
        new ManagementError(
          "bridge_unavailable",
          "OMS API could not be reached; inspect operation status before retrying.",
          502
        )
      )
    );
    if (serialized) {
      request.write(serialized);
    }
    request.end();
  });
}
export async function verifyBinding(
  connection: Connection,
  config: Config,
  databaseIdentity: string | null
) {
  invariant(
    !connection.api?.databaseIdentity ||
      connection.api.databaseIdentity === databaseIdentity,
    "binding_mismatch",
    "The saved API connection belongs to a different database identity. Reconnect before continuing.",
    409
  );
  const identity = (await bridgeRequest(
    connection,
    config,
    "identity"
  )) as Record<string, unknown>;
  invariant(
    identity &&
      identity.fingerprint === databaseFingerprint(connection) &&
      (!databaseIdentity || identity.databaseIdentity === databaseIdentity),
    "binding_mismatch",
    "This API is connected to a different OMS database. Check the API URL and database connection.",
    409
  );
  invariant(
    identity.version === 2 ||
      (typeof identity.databaseIdentity === "string" &&
        typeof identity.deploymentId === "string"),
    "bridge_invalid",
    "The OMS API returned an unsupported identity response.",
    502
  );
  if (connection.api) {
    // Seeded token-only presets may contact a v1 bridge before their first edit.
    // Use the verified discovery for this request; save() persists it on normal edits.
    if (typeof identity.databaseIdentity === "string") {
      connection.api.databaseIdentity = identity.databaseIdentity;
    }
    if (identity.version !== 2 && typeof identity.deploymentId === "string") {
      connection.api.deploymentId = identity.deploymentId;
    }
  }
  return identity;
}
