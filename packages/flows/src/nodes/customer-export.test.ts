import { describe, expect, it, vi } from "vitest";
import { resolveTemplate } from "../definition/template";
import type { NodeContext } from "../registry/define-node";
import { csvCell, dataExportCsvNode } from "./data-export-csv";
import { shopifyFetchCustomersNode } from "./shopify-fetch-customers";

const context = () => {
  const state = new Map<string, unknown>();
  const blobs = new Map<string, Record<string, unknown>>();
  return {
    logger: { info: vi.fn(), warn: vi.fn() },
    resolve: (template, current) =>
      resolveTemplate(template, {
        json: current.json,
        run: {},
        trigger: { search: "updated_at:>=2026-10-20" },
      }),
    run: {
      flowId: "flow",
      id: "run",
      organizationId: "org",
      storeId: "store",
      triggerType: "manual",
    },
    shopify: { request: vi.fn() },
    signal: new AbortController().signal,
    stepState: {
      get: vi.fn(async (key) => state.get(key) as never),
      set: vi.fn((key, value) => {
        state.set(key, value);
        return Promise.resolve();
      }),
    },
    storage: {
      checkpoints: {
        read: vi.fn((key: string) =>
          Promise.resolve(structuredClone(blobs.get(key) ?? {}))
        ),
        write: vi.fn((key: string, value: Record<string, unknown>) => {
          blobs.set(key, structuredClone(value));
          return Promise.resolve();
        }),
      },
      readAsset: vi.fn(),
      writeAsset: vi.fn<NonNullable<NodeContext["storage"]["writeAsset"]>>(
        async () => ({
          fileName: "customers.csv",
          id: "file",
          sizeBytes: 100,
        })
      ),
    },
    store: {
      apiVersion: "2026-10",
      currencyCode: null,
      id: "store",
      name: "Store",
      shopDomain: "store.myshopify.com",
    },
  } satisfies NodeContext;
};
const page = (
  nodes: Record<string, unknown>[],
  hasNextPage = false,
  endCursor: string | null = null
) => ({ customers: { nodes, pageInfo: { endCursor, hasNextPage } } });
const fetchConfig = shopifyFetchCustomersNode.configSchema.parse({
  query: "{{ $trigger.search }}",
  sortKey: "UPDATED_AT",
});
const csvConfig = dataExportCsvNode.configSchema.parse({
  columns: [
    { header: "Customer", value: "{{ $json.name }}" },
    { header: "Email", value: "{{ $json.email.address }}" },
  ],
});
const item = { json: {}, key: "0" };

describe("customer CSV export", () => {
  it("resumes after a failed page using committed data and cursor", async () => {
    const ctx = context();
    ctx.shopify.request
      .mockResolvedValueOnce(page([{ id: "1" }], true, "cursor-1"))
      .mockRejectedValueOnce(new Error("Network unavailable"));
    await expect(
      shopifyFetchCustomersNode.execute({ config: fetchConfig, ctx, item })
    ).rejects.toThrow("Network unavailable");
    expect(await ctx.stepState.get("customers:0")).toMatchObject({
      after: "cursor-1",
      customers: 1,
      done: false,
      pages: 1,
    });
    ctx.shopify.request.mockResolvedValueOnce(page([{ id: "2" }]));
    const result = await shopifyFetchCustomersNode.execute({
      config: fetchConfig,
      ctx,
      item,
    });
    expect(ctx.shopify.request.mock.calls[2]?.[1]).toMatchObject({
      after: "cursor-1",
    });
    expect(result.outputs.flatMap((output) => output.json.rows)).toEqual([
      { id: "1" },
      { id: "2" },
    ]);
    // If interrupted after the final checkpoint, replay the stored pages without a network call.
    const replay = await shopifyFetchCustomersNode.execute({
      config: fetchConfig,
      ctx,
      item,
    });
    expect(replay).toEqual(result);
    expect(ctx.shopify.request).toHaveBeenCalledTimes(3);
  });

  it("does not advance the cursor when a batch cannot be stored", async () => {
    const ctx = context();
    ctx.shopify.request.mockResolvedValue(page([{ id: "1" }]));
    ctx.storage.checkpoints.write.mockRejectedValueOnce(
      new Error("Storage unavailable")
    );
    await expect(
      shopifyFetchCustomersNode.execute({ config: fetchConfig, ctx, item })
    ).rejects.toThrow("Storage unavailable");
    expect(await ctx.stepState.get("customers:0")).toBeUndefined();
    const result = await shopifyFetchCustomersNode.execute({
      config: fetchConfig,
      ctx,
      item,
    });
    expect(result.outputs).toHaveLength(1);
    expect(ctx.shopify.request.mock.calls[1]?.[1]).toMatchObject({
      after: null,
    });
  });

  it("overwrites an uncommitted batch instead of duplicating rows", async () => {
    const ctx = context();
    ctx.shopify.request.mockResolvedValue(page([{ id: "1" }]));
    ctx.stepState.set.mockRejectedValueOnce(
      new Error("Checkpoint commit failed")
    );
    await expect(
      shopifyFetchCustomersNode.execute({ config: fetchConfig, ctx, item })
    ).rejects.toThrow("Checkpoint commit failed");
    const result = await shopifyFetchCustomersNode.execute({
      config: fetchConfig,
      ctx,
      item,
    });
    expect(result.outputs.flatMap((output) => output.json.rows)).toEqual([
      { id: "1" },
    ]);
    expect(
      ctx.storage.checkpoints.write.mock.calls.map(([key]) => key)
    ).toEqual(["customers:0:0", "customers:0:0"]);
  });

  it("continues Admin GraphQL pagination past 25,000 customers", async () => {
    const ctx = context();
    for (let pageIndex = 0; pageIndex < 101; pageIndex += 1) {
      ctx.shopify.request.mockResolvedValueOnce(
        page(
          Array.from({ length: 250 }, (_, index) => ({
            id: String(pageIndex * 250 + index),
          })),
          pageIndex < 100,
          String(pageIndex)
        )
      );
    }
    const fetched = await shopifyFetchCustomersNode.execute({
      config: { ...fetchConfig, pageSize: 250 },
      ctx,
      item,
    });
    expect(ctx.shopify.request).toHaveBeenCalledTimes(101);
    expect(fetched.outputs).toHaveLength(101);
    expect(fetched.outputs.flatMap((output) => output.json.rows).length).toBe(
      25_250
    );
  });
  it("fetches every page using the resolved filter and maps nested fields into one file", async () => {
    const ctx = context();
    ctx.shopify.request
      .mockResolvedValueOnce(
        page(
          [{ email: { address: "a@example.com" }, name: 'Anh, "A"' }],
          true,
          "next"
        )
      )
      .mockResolvedValueOnce(page([{ email: null, name: "Line\nTwo" }]));
    const fetched = await shopifyFetchCustomersNode.execute({
      config: fetchConfig,
      ctx,
      item,
    });
    expect(ctx.shopify.request.mock.calls[1]?.[1]).toMatchObject({
      after: "next",
      query: "updated_at:>=2026-10-20",
      sortKey: "UPDATED_AT",
    });
    const items = fetched.outputs.map((output, index) => ({
      json: output.json,
      key: String(index),
    }));
    const result = await dataExportCsvNode.executeBatch?.({
      config: csvConfig,
      ctx,
      items,
    });
    expect(result?.results[0]).toMatchObject({
      outputs: [{ json: { id: "file", rowCount: 2 } }],
    });
    const file = vi.mocked(ctx.storage.writeAsset).mock.calls[0]?.[0];
    expect(new TextDecoder().decode(file?.body)).toBe(
      '"Customer","Email"\r\n"Anh, ""A""","a@example.com"\r\n"Line\nTwo",""\r\n'
    );
    await dataExportCsvNode.executeBatch?.({
      config: csvConfig,
      ctx,
      items: items.slice(1),
    });
    expect(ctx.storage.writeAsset).toHaveBeenCalledTimes(1);
  });
  it("writes a header-only file when the search returns no customers", async () => {
    const ctx = context();
    ctx.shopify.request.mockResolvedValue(page([]));
    const fetched = await shopifyFetchCustomersNode.execute({
      config: fetchConfig,
      ctx,
      item,
    });
    const result = await dataExportCsvNode.executeBatch?.({
      config: csvConfig,
      ctx,
      items: [{ json: fetched.outputs[0]?.json ?? {}, key: "0" }],
    });
    expect(result?.results[0]).toMatchObject({
      outputs: [{ json: { rowCount: 0 } }],
    });
  });
  it("refuses stalled pagination and does not publish partial results", async () => {
    const ctx = context();
    ctx.shopify.request.mockResolvedValue(page([{ id: "1" }], true, "same"));
    await expect(
      shopifyFetchCustomersNode.execute({ config: fetchConfig, ctx, item })
    ).rejects.toThrow("advance");
    expect(ctx.storage.writeAsset).not.toHaveBeenCalled();
  });
  it("rejects invalid row mappings before storing a file", async () => {
    const ctx = context();
    await expect(
      dataExportCsvNode.executeBatch?.({
        config: csvConfig,
        ctx,
        items: [item],
      })
    ).rejects.toThrow("array");
    expect(ctx.storage.writeAsset).not.toHaveBeenCalled();
  });
  it("escapes CSV and protects spreadsheet formula cells without changing numbers", () => {
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell(-42)).toBe('"-42"');
    expect(csvCell(["a", "b"])).toBe('"[""a"",""b""]"');
    expect(csvCell(undefined)).toBe('""');
  });
});
