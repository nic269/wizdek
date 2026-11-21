import { WIZDEK_SDK_TYPES } from "@repo/functions/definition";
import { languages } from "monaco-editor";
import { Delayer } from "monaco-editor/esm/vs/base/common/async.js";
import { isCancellationError } from "monaco-editor/esm/vs/base/common/errors.js";

type WorkerFactory = (workerId: string, label: string) => Worker;

interface MonacoEnvironmentLike {
  getWorker?: WorkerFactory;
  installedBy?: string;
}

const OWNER = "functions-editor";

/**
 * Points Monaco at its workers. GraphiQL installs its own environment on
 * another route, so labels this editor does not handle are passed to the
 * environment that was there before, and the setup runs on every mount so
 * whichever page mounted last still finds the workers it needs.
 */
const installWorkers = () => {
  const scope = globalThis as { MonacoEnvironment?: MonacoEnvironmentLike };
  const previous = scope.MonacoEnvironment;
  if (previous?.installedBy === OWNER) {
    return;
  }
  const fallback = previous?.getWorker;
  scope.MonacoEnvironment = {
    getWorker(workerId, label) {
      switch (label) {
        case "typescript":
        case "javascript":
          return new Worker(
            new URL(
              "monaco-editor/esm/vs/language/typescript/ts.worker.js",
              import.meta.url
            )
          );
        case "json":
          return new Worker(
            new URL(
              "monaco-editor/esm/vs/language/json/json.worker.js",
              import.meta.url
            )
          );
        case "editorWorkerService":
          return new Worker(
            new URL(
              "monaco-editor/esm/vs/editor/editor.worker.js",
              import.meta.url
            )
          );
        default:
          return fallback
            ? fallback(workerId, label)
            : new Worker(
                new URL(
                  "monaco-editor/esm/vs/editor/editor.worker.js",
                  import.meta.url
                )
              );
      }
    },
    installedBy: OWNER,
  };
};

/**
 * Packages installed on the runner have no types in the browser, so every
 * package import is typed loosely. Relative imports never match this
 * declaration, so a path to a missing file is still reported.
 */
const ANY_PACKAGE = `declare module "*";`;

/** Node globals scripts commonly use, typed loosely. */
const NODE_GLOBALS = `
declare var process: {
  env: Record<string, string | undefined>;
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
};
declare function require(id: string): any;
declare var module: { exports: any };
declare var Buffer: any;
declare var __dirname: string;
declare var __filename: string;
`;

let delayerPatched = false;

/**
 * Disposing an editor cancels its word highlighter's pending `Delayer`, which
 * rejects a promise nobody awaits, so every unmount reported an unhandled
 * "Canceled" rejection (on each mount in development, where React mounts
 * twice). Each delayed promise gets a handler that drops cancellations and
 * re-raises anything else, so real errors are still reported.
 */
const quietDelayerCancels = () => {
  if (delayerPatched) {
    return;
  }
  delayerPatched = true;
  const handled = new WeakSet<Promise<unknown>>();
  const { trigger } = Delayer.prototype;
  Delayer.prototype.trigger = function (this: Delayer<unknown>, ...args) {
    const promise = trigger.apply(this, args);
    if (!handled.has(promise)) {
      handled.add(promise);
      promise.catch((error: unknown) => {
        if (!isCancellationError(error)) {
          throw error;
        }
      });
    }
    return promise;
  };
};

let languagesConfigured = false;

const configureLanguages = () => {
  if (languagesConfigured) {
    return;
  }
  languagesConfigured = true;
  quietDelayerCancels();
  const { typescript } = languages;
  const compilerOptions: languages.typescript.CompilerOptions = {
    allowImportingTsExtensions: true,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    module: typescript.ModuleKind.ESNext,
    // Like the runner: `./lib/util`, `./lib/util.ts` and a folder's index.
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
    noEmit: true,
    target: typescript.ScriptTarget.ESNext,
  };
  for (const defaults of [
    typescript.typescriptDefaults,
    typescript.javascriptDefaults,
  ]) {
    defaults.setCompilerOptions(compilerOptions);
    defaults.setEagerModelSync(true);
    defaults.addExtraLib(NODE_GLOBALS, "file:///node-globals.d.ts");
    defaults.addExtraLib(ANY_PACKAGE, "file:///any-package.d.ts");
    // A named module wins over the wildcard, so the helpers keep their types.
    defaults.addExtraLib(WIZDEK_SDK_TYPES, "file:///wizdek.d.ts");
  }
};

/** Prepares Monaco for the functions editor; safe to call on every mount. */
export const setupMonaco = () => {
  installWorkers();
  configureLanguages();
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  cjs: "javascript",
  css: "css",
  html: "html",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  sh: "shell",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  yaml: "yaml",
  yml: "yaml",
};

/** Monaco's language for a file path, by extension. */
export const languageOf = (path: string): string => {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? "plaintext";
};
