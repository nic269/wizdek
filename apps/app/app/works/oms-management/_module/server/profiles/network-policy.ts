import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Config } from "../config";
import { invariant } from "../errors";
import type { Connection } from "./schema";
export function forbiddenAddress(
  address: string,
  allowLoopback = false
): boolean {
  const ip = address.toLowerCase();
  if (ip.includes(":")) {
    if (ip === "::1") {
      return !allowLoopback;
    }
    // Reject IPv4-mapped, link-local, multicast, unspecified and transition ranges.
    return (
      ip.startsWith("::") ||
      ip.startsWith("fe8") ||
      ip.startsWith("fe9") ||
      ip.startsWith("fea") ||
      ip.startsWith("feb") ||
      ip.startsWith("ff") ||
      ip.startsWith("2002:") ||
      ip.startsWith("2001:0:")
    );
  }
  const n = ip.split(".").map(Number);
  if (
    n.length !== 4 ||
    n.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
  ) {
    return true;
  }
  const [first = Number.NaN, second = Number.NaN] = n;
  return (
    first === 0 ||
    (first === 127 && !allowLoopback) ||
    (first === 169 && second === 254) ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127)
  );
}
export async function pinnedAddress(
  host: string,
  allowLoopback: boolean
): Promise<{ address: string; family: number }> {
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  const [address] = addresses;
  invariant(
    address &&
      addresses.every((item) => !forbiddenAddress(item.address, allowLoopback)),
    "network_denied",
    "The resolved endpoint is not allowed.",
    400
  );
  return address;
}
export async function validateNetwork(connection: Connection, config: Config) {
  invariant(
    config.dbHosts.size === 0 || config.dbHosts.has(connection.database.host),
    "host_denied",
    "The DB host must be allowlisted by the server operator.",
    403
  );
  invariant(
    !config.dbPorts ||
      config.dbPorts.size === 0 ||
      config.dbPorts.has(connection.database.port),
    "port_denied",
    "The DB port must be allowlisted by the server operator.",
    403
  );
  const db = await pinnedAddress(
    connection.database.host,
    config.allowLoopback
  );
  let api: { address: string; family: number } | null = null;
  if (connection.api) {
    const url = new URL(connection.api.origin);
    invariant(
      url.origin === connection.api.origin &&
        !url.username &&
        !url.password &&
        (config.apiOrigins.size === 0 || config.apiOrigins.has(url.origin)),
      "origin_denied",
      "The API origin must be allowlisted by the server operator.",
      403
    );
    invariant(
      url.protocol === "https:" ||
        (config.allowLoopback && url.protocol === "http:"),
      "tls_required",
      "HTTPS is required for the API."
    );
    api = await pinnedAddress(
      url.hostname.replace(/^\[|\]$/g, ""),
      config.allowLoopback
    );
  }
  return { api, db };
}
