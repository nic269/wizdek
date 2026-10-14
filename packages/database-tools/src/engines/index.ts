import { DatabaseToolsError } from "../errors";
import { postgresAdapter } from "./postgres";
import type { DatabaseEngine, DatabaseEngineAdapter } from "./types";

const ADAPTERS: readonly DatabaseEngineAdapter[] = [postgresAdapter];

const URL_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

export const adapterForEngine = (
  engine: DatabaseEngine
): DatabaseEngineAdapter => {
  const adapter = ADAPTERS.find((candidate) => candidate.engine === engine);
  if (!adapter) {
    throw new DatabaseToolsError(
      "UNSUPPORTED_ENGINE",
      `The ${engine} engine is not supported.`
    );
  }
  return adapter;
};

/** Chooses the adapter from the URL's scheme. The URL is never echoed back. */
export const resolveAdapter = (url: string): DatabaseEngineAdapter => {
  const scheme = URL_SCHEME.exec(url.trim())?.[1]?.toLowerCase();
  if (!scheme) {
    throw new DatabaseToolsError(
      "INVALID_URL",
      "The connection URL must start with a scheme such as postgresql://."
    );
  }
  const adapter = ADAPTERS.find((candidate) =>
    candidate.schemes.includes(scheme)
  );
  if (!adapter) {
    const supported = ADAPTERS.map(({ label }) => label).join(", ");
    throw new DatabaseToolsError(
      "UNSUPPORTED_ENGINE",
      `"${scheme}" connections are not supported yet. Supported: ${supported}.`
    );
  }
  return adapter;
};

export type {
  DatabaseEngine,
  DatabaseEngineAdapter,
  DatabaseTarget,
} from "./types";
