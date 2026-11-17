import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { FunctionsError } from "./errors";

export const keys = () =>
  createEnv({
    emptyStringAsUndefined: true,
    runtimeEnv: process.env,
    server: {
      /** Bearer token the agent expects; required with the URL. */
      FUNCTIONS_RUNNER_TOKEN: z.string().min(32).optional(),
      /** The runner agent's address. Functions are off while it is unset. */
      FUNCTIONS_RUNNER_URL: z.url().optional(),
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    },
    skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  });

const TRAILING_SLASHES = /\/+$/;

export interface RunnerSettings {
  token: string;
  url: string;
}

/**
 * The runner's address and token, undefined while functions are off. Throws
 * when the configuration is half done or unsafe for production.
 */
export const runnerSettings = (): RunnerSettings | undefined => {
  const values = keys();
  const url = values.FUNCTIONS_RUNNER_URL;
  if (!url) {
    return;
  }
  if (!values.FUNCTIONS_RUNNER_TOKEN) {
    throw new Error(
      "FUNCTIONS_RUNNER_TOKEN is required when FUNCTIONS_RUNNER_URL is set."
    );
  }
  if (values.NODE_ENV === "production" && new URL(url).protocol !== "https:") {
    throw new Error("FUNCTIONS_RUNNER_URL must use https in production.");
  }
  return {
    token: values.FUNCTIONS_RUNNER_TOKEN,
    url: url.replace(TRAILING_SLASHES, ""),
  };
};

export const functionsEnabled = (): boolean => runnerSettings() !== undefined;

/** Fails at startup instead of on the first run when the setup is wrong. */
export const assertFunctionsConfiguration = (): void => {
  runnerSettings();
};

export const functionsDisabled = () =>
  new FunctionsError(
    "FUNCTIONS_DISABLED",
    "Functions are not enabled on this server."
  );
