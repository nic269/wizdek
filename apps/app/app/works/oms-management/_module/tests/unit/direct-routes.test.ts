import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  catalog: vi.fn().mockResolvedValue({ jobs: [], shopify: { stores: [] } }),
  original: vi.fn().mockResolvedValue({
    content: Buffer.from("original"),
    contentType: "text/csv",
    disposition: 'attachment; filename="original.csv"',
  }),
  resolve: vi.fn(),
  reveal: vi.fn().mockResolvedValue({ secret: "fixture-secret" }),
}));
vi.mock("../../server/http/guard", () => ({
  guard: (_request: Request, handler: (context: unknown) => unknown) =>
    handler({ actor: { id: "operator", name: "Operator" }, config: {} }),
  readBody: (request: Request) => request.json(),
}));
vi.mock("../../server/target/context", () => ({
  profiles: () => ({ resolve: mocks.resolve, store: { audit: mocks.audit } }),
  readTarget: (
    _actor: unknown,
    _ref: unknown,
    _config: unknown,
    _feature: unknown,
    handler: (db: unknown, connection: unknown) => unknown
  ) => handler({}, { accountIds: [], api: null, globalDiagnostics: true }),
}));
vi.mock("../../server/services/direct-reads", () => ({
  directCatalog: mocks.catalog,
  directReveal: mocks.reveal,
}));
vi.mock("../../server/services/workflow-import-file", () => ({
  workflowImportFile: mocks.original,
}));
vi.mock("../../server/oms-api/client", () => ({
  bridgeRequest: () => {
    throw new Error("Unexpected OMS API request");
  },
  verifyBinding: () => {
    throw new Error("Unexpected API binding request");
  },
}));

import { GET, POST } from "../../../api/bridge/route";
import { GET as importGET } from "../../../api/import-file/route";

const body = (action: string) =>
  new Request("http://localhost/works/oms-management/api/bridge", {
    body: JSON.stringify({
      accountId: "account",
      action,
      payload: { id: "record", storeId: "store" },
      profileId: "stage",
      revision: 1,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

describe("direct management routes", () => {
  it("returns catalog without an API connection", async () => {
    const response = await GET(
      new Request(
        "http://localhost/works/oms-management/api/bridge?profileId=stage&revision=1"
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { jobs: [], shopify: { stores: [] } },
    });
  });
  it("reveals through audited local credential reads", async () => {
    const response = await POST(body("shopify.token.reveal"));
    expect(await response.json()).toEqual({ secret: "fixture-secret" });
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "secrets:reveal"
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      "operator",
      "stage",
      1,
      "shopify.token.reveal",
      expect.objectContaining({ outcome: "succeeded" })
    );
  });
  it.each([
    "download.original",
  ])("downloads %s without an API connection", async (action) => {
    const response = await POST(body(action));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it.each([
    "download.waybill",
    "download.documents",
  ])("rejects removed action %s", async (action) => {
    await expect(POST(body(action))).rejects.toMatchObject({
      name: "ZodError",
    });
  });
  it("downloads a workflow original using only its DB-scoped service", async () => {
    const response = await importGET(
      new Request(
        "http://localhost/works/oms-management/api/import-file?profileId=stage&revision=1&id=record"
      )
    );
    expect(await response.text()).toBe("original");
    expect(mocks.original).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ api: null }),
      "record"
    );
  });
});
