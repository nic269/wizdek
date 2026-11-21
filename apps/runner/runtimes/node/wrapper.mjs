// Runs inside the sandbox container. Reads one JSON request from stdin,
// calls the function's `main`, and ends stdout with one line holding the
// result: `<marker> <json>`.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const RELATIVE = /^\.{1,2}\//;
const SDK_URL = pathToFileURL("/opt/fn/wizdek.mjs").href;
const TRAILING_SLASH = /\/$/;
const NOT_FOUND = new Set([
  "ERR_MODULE_NOT_FOUND",
  "ERR_UNSUPPORTED_DIR_IMPORT",
]);
const CANDIDATE_SUFFIXES = [
  ".ts",
  ".mts",
  ".js",
  ".mjs",
  "/index.ts",
  "/index.mts",
  "/index.js",
  "/index.mjs",
];

// Node wants the full file name in an import. Function authors write
// `./lib/util` as TypeScript and the editor do, so a relative import that
// does not resolve as written is tried with the usual extensions and as a
// folder with an index file.
registerHooks({
  resolve(specifier, context, nextResolve) {
    // The built-in helpers, ahead of any installed package of that name.
    if (specifier === "wizdek") {
      return { shortCircuit: true, url: SDK_URL };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!(RELATIVE.test(specifier) && NOT_FOUND.has(error?.code))) {
        throw error;
      }
      const base = specifier.replace(TRAILING_SLASH, "");
      for (const suffix of CANDIDATE_SUFFIXES) {
        try {
          return nextResolve(`${base}${suffix}`, context);
        } catch (candidateError) {
          if (!NOT_FOUND.has(candidateError?.code)) {
            throw candidateError;
          }
        }
      }
      throw error;
    }
  },
});

const readRequest = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const write = (stream, text) =>
  new Promise((resolve) => {
    stream.write(text, resolve);
  });

const request = await readRequest();
const finish = async (code, result) => {
  await write(process.stdout, `\n${request.marker} ${result}\n`);
  // Exit even when the function left timers or sockets open.
  process.exit(code);
};

try {
  for (const [name, value] of Object.entries(request.env)) {
    process.env[name] = value;
  }
  const loaded = await import(pathToFileURL(`/fn/${request.entry}`).href);
  // A CommonJS file arrives as `default`.
  const main = loaded.main ?? loaded.default?.main;
  if (typeof main !== "function") {
    throw new Error(`${request.entry} must export a function named main.`);
  }
  const value = await main(
    ...request.order.map((name) => request.params[name])
  );
  let result;
  try {
    result = JSON.stringify({ ok: true, value: value ?? null });
  } catch (error) {
    throw new Error(`The value main returned is not JSON: ${error.message}`);
  }
  await finish(0, result);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await write(
    process.stderr,
    `${error instanceof Error && error.stack ? error.stack : message}\n`
  );
  await finish(1, JSON.stringify({ error: message, ok: false }));
}
