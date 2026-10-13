import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULTS = {
  API_INTERNAL_URL: "http://localhost:3002",
  BETTER_AUTH_SECRET: "local-e2e-better-auth-secret-at-least-32",
  BETTER_AUTH_URL: "http://localhost:3002/api/auth",
  NEXT_PUBLIC_API_URL: "http://localhost:3002",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_WEB_URL: "http://localhost:3001",
  PLAYWRIGHT_REUSE_SERVER: "false",
};

const isPortInUse = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 1000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });

const firstOpenPort = async (start) => {
  for (let port = start; port < start + 50; port += 1) {
    if (!(await isPortInUse(port))) {
      return port;
    }
  }

  throw new Error(
    `No open PostgreSQL port found from ${start} to ${start + 49}.`
  );
};

let activeChild;
let receivedSignal;

const run = (
  command,
  args,
  commandEnv,
  { allowDuringShutdown = false, timeoutMs } = {}
) =>
  new Promise((resolve, reject) => {
    if (receivedSignal && !allowDuringShutdown) {
      reject(new Error(`Interrupted by ${receivedSignal}.`));
      return;
    }

    const child = spawn(command, args, {
      env: commandEnv,
      stdio: "inherit",
    });
    activeChild = child;
    let settled = false;
    let timeout;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (activeChild === child) {
        activeChild = undefined;
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (receivedSignal && !allowDuringShutdown) {
        finish(new Error(`Interrupted by ${receivedSignal}.`));
      } else if (code === 0) {
        finish();
      } else {
        finish(
          new Error(
            `${command} ${args.join(" ")} failed with ${
              signal ? `signal ${signal}` : `exit code ${code ?? 1}`
            }`
          )
        );
      }
    });

    if (timeoutMs) {
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
        const escalation = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }, 2000);
        escalation.unref();
      }, timeoutMs);
      timeout.unref();
    }
  });

let composeAttempted = false;
let env;
let mailOutboxDirectory;
let playwrightArtifactsDirectory;
const composeProject = `wizloft-e2e-${process.pid}`;
const handleInterrupt = (signal) => {
  if (receivedSignal) {
    return;
  }
  receivedSignal = signal;
  const interruptedChild = activeChild;
  if (
    interruptedChild &&
    interruptedChild.exitCode === null &&
    interruptedChild.signalCode === null
  ) {
    interruptedChild.kill(signal);
    const escalation = setTimeout(() => {
      if (
        interruptedChild.exitCode === null &&
        interruptedChild.signalCode === null
      ) {
        interruptedChild.kill("SIGKILL");
      }
    }, 5000);
    interruptedChild.once("exit", () => clearTimeout(escalation));
  }
};
const throwIfInterrupted = () => {
  if (receivedSignal) {
    throw new Error(`Interrupted by ${receivedSignal}.`);
  }
};
const handleSigint = () => handleInterrupt("SIGINT");
const handleSigterm = () => handleInterrupt("SIGTERM");
process.on("SIGINT", handleSigint);
process.on("SIGTERM", handleSigterm);

let primaryError;
let cleanupError;
try {
  const requestedPort = Number(process.env.POSTGRES_PORT ?? 5432);
  const postgresPort = await firstOpenPort(
    Number.isFinite(requestedPort) ? requestedPort : 5432
  );
  throwIfInterrupted();
  const databaseUrl = `postgresql://postgres:postgres@localhost:${postgresPort}/shopify_toolkit`;
  mailOutboxDirectory = mkdtempSync(join(tmpdir(), "wizloft-e2e-mail-"));
  playwrightArtifactsDirectory = mkdtempSync(
    join(tmpdir(), "wizloft-e2e-playwright-")
  );
  env = {
    ...DEFAULTS,
    ...process.env,
    API_INTERNAL_URL: DEFAULTS.API_INTERNAL_URL,
    BETTER_AUTH_URL: DEFAULTS.BETTER_AUTH_URL,
    DATABASE_URL: databaseUrl,
    MAIL_OUTBOX_DIR: mailOutboxDirectory,
    MAIL_PROVIDER: "console",
    NEXT_PUBLIC_API_URL: DEFAULTS.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_URL: DEFAULTS.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_WEB_URL: DEFAULTS.NEXT_PUBLIC_WEB_URL,
    PLAYWRIGHT_HTML_OUTPUT_DIR: join(playwrightArtifactsDirectory, "report"),
    PLAYWRIGHT_OUTPUT_DIR: join(playwrightArtifactsDirectory, "results"),
    PLAYWRIGHT_REUSE_SERVER: "false",
    POSTGRES_PORT: String(postgresPort),
  };
  console.log(`Using PostgreSQL on localhost:${postgresPort}`);
  const occupiedServicePorts = (
    await Promise.all(
      [3000, 3002].map(async (port) => [port, await isPortInUse(port)])
    )
  )
    .filter(([, occupied]) => occupied)
    .map(([port]) => port);
  if (occupiedServicePorts.length > 0) {
    throw new Error(
      `E2E requires free app/API ports; already in use: ${occupiedServicePorts.join(", ")}`
    );
  }
  throwIfInterrupted();
  composeAttempted = true;
  await run(
    "docker",
    [
      "compose",
      "--project-name",
      composeProject,
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "45",
      "postgres",
    ],
    env
  );
  await run("pnpm", ["db:generate"], env);
  await run("pnpm", ["db:migrate:deploy"], env);
  await run("pnpm", ["--filter", "@repo/auth", "test:integration"], env);
  await run("pnpm", ["test:e2e"], env);
} catch (error) {
  primaryError = error;
} finally {
  if (composeAttempted && env) {
    try {
      await run(
        "docker",
        [
          "compose",
          "--project-name",
          composeProject,
          "down",
          "--volumes",
          "--remove-orphans",
        ],
        env,
        { allowDuringShutdown: true, timeoutMs: 30_000 }
      );
    } catch (error) {
      cleanupError = error;
    }
  }
  for (const path of [mailOutboxDirectory, playwrightArtifactsDirectory]) {
    if (!path) {
      continue;
    }
    try {
      rmSync(path, { force: true, recursive: true });
    } catch (error) {
      cleanupError ??= error;
    }
  }
}
process.off("SIGINT", handleSigint);
process.off("SIGTERM", handleSigterm);

if (receivedSignal) {
  if (cleanupError) {
    console.error("E2E database cleanup also failed:", cleanupError);
  }
  process.kill(process.pid, receivedSignal);
}

if (primaryError) {
  if (cleanupError) {
    console.error("E2E database cleanup also failed:", cleanupError);
  }
  throw primaryError;
}
if (cleanupError) {
  throw cleanupError;
}
