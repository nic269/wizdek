import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi-client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { contract } from "../contracts";
import { decodeApiError } from "./errors";

export interface ApiClientOptions {
  baseUrl: string | (() => string);
  fetch?: typeof fetch;
  headers?:
    | Headers
    | Record<string, string | string[] | undefined>
    | (() =>
        | Headers
        | Record<string, string | string[] | undefined>
        | Promise<Headers | Record<string, string | string[] | undefined>>);
}

export const createApiClient = ({
  baseUrl,
  fetch: fetcher = globalThis.fetch,
  headers,
}: ApiClientOptions) => {
  const link = new OpenAPILink(contract, {
    customErrorResponseBodyDecoder: decodeApiError,
    fetch: (request, init) =>
      fetcher(request, { ...init, credentials: "include" }),
    ...(headers ? { headers } : {}),
    url: baseUrl,
  });

  return createORPCClient(link) as JsonifiedClient<
    ContractRouterClient<typeof contract>
  >;
};

export type ApiClient = ReturnType<typeof createApiClient>;
