import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestContext, sanitizeRequestId } from "./context";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const loggerMocks = vi.hoisted(() => ({
  createLogger: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@repo/logger", () => ({
  createLogger: loggerMocks.createLogger.mockImplementation(() => ({
    child: vi.fn(),
    debug: loggerMocks.debug,
    error: loggerMocks.error,
    info: loggerMocks.info,
    warn: loggerMocks.warn,
  })),
}));

const createTestApp = () => {
  const app = new Hono();
  app.use("*", requestContext);
  app.get("/ok", (context) => context.json({ ok: true }));
  app.get("/error", () => {
    throw new Error("boom");
  });
  app.onError((_error, context) => context.json({ error: "failed" }, 500));
  return app;
};

describe("API request context", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves a safe caller request ID everywhere", async () => {
    const response = await createTestApp().request("/ok", {
      headers: { "x-request-id": "req.safe:1" },
    });

    expect(response.headers.get("x-request-id")).toBe("req.safe:1");
    expect(loggerMocks.createLogger).toHaveBeenCalledWith({
      requestId: "req.safe:1",
      route: "/ok",
    });
    expect(loggerMocks.info).toHaveBeenCalledOnce();
    expect(loggerMocks.info).toHaveBeenCalledWith("api.request", {
      durationMs: expect.any(Number),
      statusCode: 200,
    });
  });

  it.each([
    "contains spaces",
    "üñïcode",
    "x".repeat(129),
  ])("replaces unsafe caller request ID %s", async (supplied) => {
    const response = await createTestApp().request("/ok", {
      headers: { "x-request-id": supplied },
    });
    const requestId = response.headers.get("x-request-id");

    expect(requestId).toMatch(UUID_PATTERN);
    expect(requestId).not.toBe(supplied);
    expect(loggerMocks.createLogger).toHaveBeenCalledWith({
      requestId,
      route: "/ok",
    });
  });

  it("logs one completion event with the final error status", async () => {
    const response = await createTestApp().request("/error");

    expect(response.status).toBe(500);
    expect(loggerMocks.info).toHaveBeenCalledOnce();
    expect(loggerMocks.info).toHaveBeenCalledWith("api.request", {
      durationMs: expect.any(Number),
      statusCode: 500,
    });
  });

  it("logs completion from finally when next rejects", async () => {
    const values = new Map<string, unknown>();
    const context = {
      get: (key: string) => values.get(key),
      header: vi.fn(),
      req: { header: vi.fn(), path: "/rejected" },
      res: new Response(null, { status: 200 }),
      set: (key: string, value: unknown) => values.set(key, value),
    };

    await expect(
      requestContext(context as never, () =>
        Promise.reject(new Error("next rejected"))
      )
    ).rejects.toThrow("next rejected");
    expect(loggerMocks.info).toHaveBeenCalledOnce();
    expect(loggerMocks.info).toHaveBeenCalledWith("api.request", {
      durationMs: expect.any(Number),
      statusCode: 500,
    });
  });

  it("generates an ID when none is supplied", () => {
    expect(sanitizeRequestId()).toMatch(UUID_PATTERN);
  });
});
