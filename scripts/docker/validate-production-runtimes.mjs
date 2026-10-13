import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const imagePrefix = `wizloft-boilerplate-${Date.now()}`;
const networkName = `${imagePrefix}-net`;
const containerNames = [];
const MISSING_DOCKER_RESOURCE_PATTERN =
  /(?:No such (?:container|image)|network .+ not found)/iu;

const pathExists = (path) =>
  access(resolve(workspaceRoot, path)).then(
    () => true,
    () => false
  );
const run = async (command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    stdio: options.stdio ?? "inherit",
  });

  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${code}`
    );
  }
};

const runQuiet = async (command, args) => {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `${command} failed`);
  }

  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
};

const findOpenPort = (start) =>
  new Promise((resolvePort, reject) => {
    const tryPort = (port) => {
      if (port > 65_535) {
        reject(new Error(`Unable to find an open port starting from ${start}`));
        return;
      }

      const server = net.createServer();
      server.unref();
      server.once("error", (error) => {
        if ("code" in error && error.code === "EADDRINUSE") {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        server.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          if (!address || typeof address === "string") {
            reject(new Error("Unable to determine an open port"));
            return;
          }
          resolvePort(address.port);
        });
      });
    };

    tryPort(start);
  });

const waitForHttp = async (url) => {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
    } catch {
      // Retry until timeout while the container boots.
    }

    await delay(1000);
  }

  throw new Error(`Timed out waiting for ${url}`);
};

const describeContainerFailure = async (containerName) => {
  try {
    const inspect = await runQuiet("docker", [
      "ps",
      "-a",
      "--filter",
      `name=${containerName}`,
      "--format",
      "{{.Status}}",
    ]);
    const logs = await runQuiet("docker", ["logs", containerName]).catch(
      () => ""
    );
    return [inspect ? `status=${inspect}` : "", logs ? `logs:\n${logs}` : ""]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
};

const assertContainerRejectsConfiguration = async ({
  containerName,
  env,
  expectedMessage,
  imageTag,
}) => {
  await removeIfExists("container", containerName);
  await run("docker", [
    "run",
    "--detach",
    "--name",
    containerName,
    ...env.flatMap((entry) => ["--env", entry]),
    imageTag,
  ]);
  let logs = "";
  let status = "unknown";
  try {
    await delay(1500);
    status = await runQuiet("docker", [
      "inspect",
      "--format",
      "{{.State.Status}}",
      containerName,
    ]);
    logs = await runQuiet("docker", ["logs", containerName]).catch(() => "");
  } finally {
    await removeIfExists("container", containerName);
  }

  if (status !== "exited" || !logs.includes(expectedMessage)) {
    throw new Error(
      `${containerName} did not reject invalid provider configuration. status=${status}\n${logs}`
    );
  }
};

const isMissingDockerResource = (error) =>
  error instanceof Error && MISSING_DOCKER_RESOURCE_PATTERN.test(error.message);

const removeDockerResource = async (kind, name, force = false) => {
  try {
    await runQuiet("docker", [kind, "rm", ...(force ? ["-f"] : []), name]);
  } catch (error) {
    if (isMissingDockerResource(error)) {
      return;
    }
    throw error;
  }
};

const removeIfExists = (kind, name) => removeDockerResource(kind, name, true);
const removeNetworkIfExists = (name) => removeDockerResource("network", name);
const removeImageIfExists = (name) => removeDockerResource("image", name, true);

const hasStorage = await pathExists("packages/storage");
const hasDocs = await pathExists("apps/docs");
const hasWeb = await pathExists("apps/web");
const apiPort = await findOpenPort(3102);
const appPort = await findOpenPort(3100);
const webPort = hasWeb ? await findOpenPort(3101) : null;

const urls = {
  api: `http://127.0.0.1:${apiPort}`,
  app: `http://127.0.0.1:${appPort}`,
  ...(hasDocs ? { docs: "http://127.0.0.1:3003" } : {}),
  ...(webPort === null ? {} : { web: `http://127.0.0.1:${webPort}` }),
};
const authWebUrl = urls.web ?? urls.app;

const buildArgs = [
  "API_INTERNAL_URL=http://api:3002",
  "APP_INTERNAL_URL=http://app:3000",
  `NEXT_PUBLIC_API_URL=${urls.api}`,
  `NEXT_PUBLIC_APP_URL=${urls.app}`,
  ...(urls.docs ? [`NEXT_PUBLIC_DOCS_URL=${urls.docs}`] : []),
  `NEXT_PUBLIC_WEB_URL=${authWebUrl}`,
];

const surfaces = [
  {
    containerName: `${imagePrefix}-api`,
    containerPort: "3002",
    env: [
      "PORT=3002",
      "NEXT_PUBLIC_API_URL=http://api:3002",
      `NEXT_PUBLIC_APP_URL=${urls.app}`,
      `NEXT_PUBLIC_WEB_URL=${authWebUrl}`,
      "BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters",
      "BETTER_AUTH_URL=http://api:3002/api/auth",
      "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/personal_saas_boilerplate",
      "MAIL_PROVIDER=resend",
      "RESEND_API_KEY=test-key",
      "RESEND_FROM_EMAIL=noreply@example.com",
    ],
    healthPath: "/health",
    hostPort: String(apiPort),
    imageTag: `${imagePrefix}:api`,
    name: "api",
    networkAlias: "api",
    scope: "@repo/api-app",
    target: "api-runner",
  },
  {
    containerName: `${imagePrefix}-app`,
    containerPort: "3000",
    env: [
      "PORT=3000",
      "API_INTERNAL_URL=http://api:3002",
      `NEXT_PUBLIC_API_URL=${urls.api}`,
      `NEXT_PUBLIC_APP_URL=${urls.app}`,
      `NEXT_PUBLIC_WEB_URL=${authWebUrl}`,
      "BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters",
      "BETTER_AUTH_URL=http://api:3002/api/auth",
      "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/personal_saas_boilerplate",
    ],
    healthPath: "/sign-in",
    hostPort: String(appPort),
    imageTag: `${imagePrefix}:app`,
    name: "app",
    networkAlias: "app",
    publicAssetPath: "/robots.txt",
    scope: "@repo/app",
    target: "app-runner",
  },
  ...(hasWeb
    ? [
        {
          containerName: `${imagePrefix}-web`,
          containerPort: "3001",
          env: [
            "PORT=3001",
            `NEXT_PUBLIC_API_URL=${urls.api}`,
            `NEXT_PUBLIC_APP_URL=${urls.app}`,
            ...(urls.docs ? [`NEXT_PUBLIC_DOCS_URL=${urls.docs}`] : []),
            `NEXT_PUBLIC_WEB_URL=${urls.web}`,
          ],
          healthPath: "/",
          hostPort: String(webPort),
          imageTag: `${imagePrefix}:web`,
          name: "web",
          networkAlias: "web",
          publicAssetPath: "/robots.txt",
          scope: "@repo/web",
          target: "web-runner",
        },
      ]
    : []),
];

let primaryError;
const cleanupErrors = [];
try {
  await runQuiet("docker", ["version"]);

  await removeNetworkIfExists(networkName);
  await run("docker", ["network", "create", networkName]);

  for (const surface of surfaces) {
    const args = [
      "build",
      "--target",
      surface.target,
      "--build-arg",
      `APP_SCOPE=${surface.scope}`,
      "-t",
      surface.imageTag,
    ];

    for (const buildArg of buildArgs) {
      args.push("--build-arg", buildArg);
    }

    args.push(".");
    await run("docker", args);
  }

  const [apiSurface] = surfaces;
  if (hasStorage) {
    await assertContainerRejectsConfiguration({
      containerName: `${imagePrefix}-invalid-storage`,
      env: [
        ...apiSurface.env,
        "STORAGE_PROVIDER=s3",
        "S3_BUCKET=private-files",
        "S3_REGION=",
        "S3_ACCESS_KEY_ID=",
        "S3_SECRET_ACCESS_KEY=",
      ],
      expectedMessage: "s3 storage configuration is missing",
      imageTag: apiSurface.imageTag,
    });
  }
  await assertContainerRejectsConfiguration({
    containerName: `${imagePrefix}-invalid-mail`,
    env: [
      ...apiSurface.env,
      "MAIL_PROVIDER=resend",
      "RESEND_API_KEY=test-key",
      "RESEND_FROM_EMAIL=",
    ],
    expectedMessage: "resend mail configuration is missing",
    imageTag: apiSurface.imageTag,
  });

  await removeIfExists("container", apiSurface.containerName);
  await run("docker", [
    "run",
    "--detach",
    "--name",
    apiSurface.containerName,
    "--network",
    networkName,
    "--network-alias",
    apiSurface.networkAlias,
    "--publish",
    `${apiSurface.hostPort}:${apiSurface.containerPort}`,
    ...apiSurface.env.flatMap((entry) => ["--env", entry]),
    apiSurface.imageTag,
  ]);
  containerNames.push(apiSurface.containerName);
  try {
    await waitForHttp(`${urls.api}${apiSurface.healthPath}`);
  } catch (error) {
    const details = await describeContainerFailure(apiSurface.containerName);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${
        details ? `\n${details}` : ""
      }`
    );
  }

  for (const surface of surfaces.slice(1)) {
    await removeIfExists("container", surface.containerName);
    await run("docker", [
      "run",
      "--detach",
      "--name",
      surface.containerName,
      "--network",
      networkName,
      "--network-alias",
      surface.networkAlias,
      "--publish",
      `${surface.hostPort}:${surface.containerPort}`,
      ...surface.env.flatMap((entry) => ["--env", entry]),
      surface.imageTag,
    ]);
    containerNames.push(surface.containerName);
    try {
      await waitForHttp(
        `${surface.name === "web" ? urls.web : urls.app}${surface.healthPath}`
      );
      const assetResponse = await fetch(
        `${surface.name === "web" ? urls.web : urls.app}${surface.publicAssetPath}`
      );
      if (
        !(
          assetResponse.ok &&
          (await assetResponse.text()).includes("User-agent")
        )
      ) {
        throw new Error(`${surface.name} public assets are unavailable.`);
      }
    } catch (error) {
      const details = await describeContainerFailure(surface.containerName);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${
          details ? `\n${details}` : ""
        }`
      );
    }
  }
} catch (error) {
  primaryError = error;
} finally {
  for (const containerName of containerNames.reverse()) {
    try {
      await removeIfExists("container", containerName);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await removeNetworkIfExists(networkName);
  } catch (error) {
    cleanupErrors.push(error);
  }
  for (const surface of surfaces) {
    try {
      await removeImageIfExists(surface.imageTag);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
}

if (primaryError) {
  if (cleanupErrors.length > 0) {
    console.error("Production container cleanup also failed:", cleanupErrors);
  }
  throw primaryError;
}
if (cleanupErrors.length > 0) {
  throw new AggregateError(
    cleanupErrors,
    "Production container cleanup failed"
  );
}

console.log("Production container validation passed.");
console.log(`API: ${urls.api}/health`);
console.log(`App: ${urls.app}/sign-in`);
if (urls.web) {
  console.log(`Web: ${urls.web}/`);
}
