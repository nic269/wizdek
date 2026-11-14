import { getCurrentSessionWithHeaders } from "@repo/auth/session";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleIdentity } from "./identity-route";

vi.mock("@repo/auth/session", () => ({
  getCurrentSessionWithHeaders: vi.fn(),
}));

const createTestApp = () => {
  const app = new Hono();
  app.get("/api/identity", handleIdentity);
  return app;
};

const session = {
  accessToken: "bearer-token",
  session: {
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    id: "session-1",
    token: "session-token",
    userId: "user-1",
  },
  user: {
    email: "user@example.com",
    id: "user-1",
    name: "User",
  },
};

describe("identity route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only public identity fields with no-store headers", async () => {
    vi.mocked(getCurrentSessionWithHeaders).mockResolvedValue({
      headers: new Headers(),
      session: session as never,
    });

    const response = await createTestApp().request("/api/identity", {
      headers: { cookie: "session=original" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(await response.json()).toEqual({
      expiresAt: "2030-01-01T00:00:00.000Z",
      user: {
        email: "user@example.com",
        id: "user-1",
        name: "User",
      },
    });
    expect(getCurrentSessionWithHeaders).toHaveBeenCalledWith(
      expect.any(Headers),
      { renew: true }
    );
  });

  it("preserves multiple Set-Cookie headers", async () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "session=renewed; Path=/; HttpOnly");
    headers.append("Set-Cookie", "cache=renewed; Path=/; HttpOnly");
    vi.mocked(getCurrentSessionWithHeaders).mockResolvedValue({
      headers,
      session: session as never,
    });

    const response = await createTestApp().request("/api/identity");

    expect(response.headers.getSetCookie()).toEqual([
      "session=renewed; Path=/; HttpOnly",
      "cache=renewed; Path=/; HttpOnly",
    ]);
  });

  it("uses non-renewing introspection when renew=false", async () => {
    vi.mocked(getCurrentSessionWithHeaders).mockResolvedValue({
      headers: new Headers(),
      session: session as never,
    });

    await createTestApp().request("/api/identity?renew=false");

    expect(getCurrentSessionWithHeaders).toHaveBeenCalledWith(
      expect.any(Headers),
      { renew: false }
    );
  });

  it("returns unauthorized without exposing credentials", async () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0");
    vi.mocked(getCurrentSessionWithHeaders).mockResolvedValue({
      headers,
      session: null,
    });

    const response = await createTestApp().request("/api/identity");
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.getSetCookie()).toEqual([
      "session=; Path=/; HttpOnly; Max-Age=0",
    ]);
    expect(body).toEqual({
      error: { code: "UNAUTHORIZED", message: "Sign in required." },
    });
    expect(JSON.stringify(body)).not.toContain("token");
  });
});
