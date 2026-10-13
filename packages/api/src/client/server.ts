import { type ApiClientOptions, createApiClient } from "./shared";

export const createServerApiClient = (options: ApiClientOptions) =>
  createApiClient(options);
