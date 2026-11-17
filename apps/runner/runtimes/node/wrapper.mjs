// Runs inside the sandbox container. Reads one JSON request from stdin,
// calls the function's `main`, and ends stdout with one line holding the
// result: `<marker> <json>`.
import { pathToFileURL } from "node:url";

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
