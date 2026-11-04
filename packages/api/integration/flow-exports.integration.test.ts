import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@repo/database";
import {
  builtInRegistry,
  createAssetReader,
  createFlow,
  executeFlowRun,
  saveFlowVersion,
  writeRunAsset,
} from "@repo/flows";
import { getStorageProvider } from "@repo/storage";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApiHarness } from "./support";

vi.mock("@repo/auth/session", () => ({ getCurrentSession: vi.fn() }));
const queued = vi.hoisted(() => vi.fn(() => Promise.resolve({ id: "job" })));
vi.mock("../src/jobs", () => ({ getJobProvider: () => ({ enqueue: queued }) }));
const directory = mkdtempSync(join(tmpdir(), "flow-exports-"));
process.env.STORAGE_PROVIDER = "local";
process.env.LOCAL_STORAGE_DIR = directory;
const { createActor, createActorWithPermissions, request, call, cleanup } =
  createApiHarness();
const assetIds: string[] = [];
afterAll(async () => {
  await prisma.fileAsset.deleteMany({ where: { id: { in: assetIds } } });
  await cleanup();
  rmSync(directory, { force: true, recursive: true });
  await prisma.$disconnect();
});

describe("stored flow exports", () => {
  it("runs fetch to CSV, persists one artifact across retry, and enforces download scope", async () => {
    const owner = await createActor("Owner");
    const outsider = await createActor("Owner");
    const denied = await createActorWithPermissions(owner.organizationId, []);
    const store = await prisma.shopifyStore.create({
      data: {
        apiVersion: "2026-10",
        name: "Export fixture",
        organizationId: owner.organizationId,
        shopDomain: `export-${randomUUID()}.myshopify.com`,
        status: "CONNECTED",
        strategy: "STATIC_TOKEN",
      },
    });
    const { flow } = await createFlow({
      actorId: owner.userId,
      name: "Customer export test",
      organizationId: owner.organizationId,
    });
    const definition = {
      edges: [
        { id: "a", source: "trigger", sourceHandle: "main", target: "fetch" },
        { id: "b", source: "fetch", sourceHandle: "main", target: "csv" },
      ],
      nodes: [
        {
          config: {},
          id: "trigger",
          name: "Trigger",
          position: { x: 0, y: 0 },
          type: "trigger.manual",
        },
        {
          config: {
            fields: "id firstName",
            query: "created_at:>=2026-10-01",
            sortKey: "CREATED_AT",
          },
          id: "fetch",
          name: "Fetch",
          position: { x: 300, y: 0 },
          type: "shopify.fetchCustomers",
        },
        {
          config: {
            columns: [{ header: "Name", value: "{{ $json.firstName }}" }],
          },
          id: "csv",
          name: "CSV",
          position: { x: 600, y: 0 },
          type: "data.exportCsv",
        },
      ],
      schemaVersion: 1,
    };
    const { version } = await saveFlowVersion(
      { flowId: flow.id, organizationId: owner.organizationId },
      { actorId: owner.userId, baseVersion: 1, definition }
    );
    const run = await prisma.flowRun.create({
      data: {
        flowId: flow.id,
        flowVersionId: version.id,
        number: 1,
        organizationId: owner.organizationId,
        storeId: store.id,
        triggerPayload: {},
        triggerType: "manual",
      },
    });
    const response = (
      name: string,
      hasNextPage: boolean,
      endCursor: string | null
    ) => ({
      body: {
        data: {
          customers: {
            nodes: [{ firstName: name, id: name }],
            pageInfo: { endCursor, hasNextPage },
          },
        },
      },
      httpStatus: 200,
    });
    const requestWithRetry = vi
      .fn()
      .mockResolvedValueOnce(response("Anh", true, "saved-cursor"))
      .mockRejectedValueOnce(new Error("Network failure"));
    const deps = {
      createStoreClient: () =>
        Promise.resolve({ requestWithRetry, store } as never),
      readAsset: createAssetReader(),
      registry: builtInRegistry,
    };
    await executeFlowRun(run.id, deps);
    const failed = await call(owner, "GET", `/api/flow-runs/${run.id}`);
    expect(failed.json.data.run.status).toBe("PARTIALLY_FAILED");
    expect(failed.json.data.canResume).toBe(true);
    expect(failed.json.data.fetchProgress).toEqual([
      { customers: 1, done: false, nodeId: "fetch", pages: 1 },
    ]);
    expect(failed.json.data.files).toHaveLength(0);
    expect(
      (await call(denied, "POST", `/api/flow-runs/${run.id}/resume`)).status
    ).toBe(403);
    expect(
      (await call(outsider, "POST", `/api/flow-runs/${run.id}/resume`)).status
    ).toBe(404);
    const resumed = await call(
      owner,
      "POST",
      `/api/flow-runs/${run.id}/resume`
    );
    expect(resumed.status).toBe(200);
    expect(resumed.json.data.id).toBe(run.id);
    expect(resumed.json.data.status).toBe("QUEUED");
    expect(
      (await call(owner, "POST", `/api/flow-runs/${run.id}/resume`)).status
    ).toBe(409);
    expect(queued).toHaveBeenCalledTimes(1);
    const shutdown = new AbortController();
    requestWithRetry
      .mockResolvedValueOnce(response("Nguyen", true, "cursor-2"))
      .mockImplementationOnce(() => {
        shutdown.abort();
        return Promise.reject(new Error("Worker stopped"));
      });
    expect(
      await executeFlowRun(run.id, { ...deps, signal: shutdown.signal })
    ).toBe("interrupted");
    const interrupted = await call(owner, "GET", `/api/flow-runs/${run.id}`);
    expect(interrupted.json.data.run.status).toBe("RUNNING");
    expect(interrupted.json.data.fetchProgress).toEqual([
      { customers: 2, done: false, nodeId: "fetch", pages: 2 },
    ]);
    expect(interrupted.json.data.files).toHaveLength(0);
    requestWithRetry.mockResolvedValueOnce(response("Final", false, null));
    // Simulate a fresh worker after shutdown; no manual resume is needed for active jobs.
    await executeFlowRun(run.id, deps);
    expect(requestWithRetry.mock.calls[2]?.[0].variables.after).toBe(
      "saved-cursor"
    );
    expect(requestWithRetry.mock.calls[4]?.[0].variables.after).toBe(
      "cursor-2"
    );
    const detail = await call(owner, "GET", `/api/flow-runs/${run.id}`);
    expect(detail.json.data.run.status).toBe("SUCCEEDED");
    expect(detail.json.data.files).toHaveLength(1);
    expect(detail.json.data.canResume).toBe(false);
    expect(
      (await call(owner, "POST", `/api/flow-runs/${run.id}/resume`)).status
    ).toBe(409);
    expect(
      await prisma.flowRunItem.count({
        where: { nodeId: "csv", runId: run.id },
      })
    ).toBe(3);
    const fileId = detail.json.data.files[0].id as string;
    assetIds.push(fileId);
    const path = `/api/flow-runs/${run.id}/files/${fileId}/download`;
    const download = await request(owner, path);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(await download.text()).toBe(
      '"Name"\r\n"Anh"\r\n"Nguyen"\r\n"Final"\r\n'
    );
    expect((await request(outsider, path)).status).toBe(404);
    expect((await request(denied, path)).status).toBe(403);
    expect((await request(null, path)).status).toBe(401);
    expect(
      (await request(owner, `/api/flow-runs/${run.id}/files/missing/download`))
        .status
    ).toBe(404);
    const file = await prisma.fileAsset.findUniqueOrThrow({
      where: { id: fileId },
    });
    const stored = await getStorageProvider().getObject({
      key: file.objectKey,
    });
    const retried = await writeRunAsset({
      asset: {
        body: stored.body,
        contentType: file.contentType,
        fileName: file.fileName,
      },
      nodeId: "csv",
      organizationId: owner.organizationId,
      runId: run.id,
    });
    expect(retried.id).toBe(fileId);
    expect(
      await prisma.fileAsset.count({
        where: { organizationId: owner.organizationId },
      })
    ).toBe(1);
    expect(requestWithRetry.mock.calls[0]?.[0].variables).toMatchObject({
      query: "created_at:>=2026-10-01",
      sortKey: "CREATED_AT",
    });
  });
});
