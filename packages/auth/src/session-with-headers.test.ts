import { prisma } from "@repo/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "./server";
import { getCurrentSessionWithHeaders } from "./session";

vi.mock("@repo/database", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock("./server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const session = {
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

const sessionHeaders = () => {
  const headers = new Headers();
  headers.append("Set-Cookie", "session=renewed; Path=/; HttpOnly");
  headers.append("Set-Cookie", "cache=renewed; Path=/; HttpOnly");
  return headers;
};

describe("getCurrentSessionWithHeaders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an active session with every renewal header", async () => {
    const headers = sessionHeaders();
    vi.mocked(auth.api.getSession).mockResolvedValue({
      headers,
      response: session,
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: true,
      status: "ACTIVE",
    } as never);

    const result = await getCurrentSessionWithHeaders(
      new Headers({ cookie: "session=original" })
    );

    expect(result.session).toEqual(session);
    expect(result.headers.getSetCookie()).toEqual([
      "session=renewed; Path=/; HttpOnly",
      "cache=renewed; Path=/; HttpOnly",
    ]);
    expect(auth.api.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { disableCookieCache: true, disableRefresh: false },
      returnHeaders: true,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      select: { emailVerified: true, status: true },
      where: { id: "user-1" },
    });
  });

  it("disables renewal for server introspection", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      headers: new Headers(),
      response: session,
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: true,
      status: "ACTIVE",
    } as never);

    await getCurrentSessionWithHeaders(new Headers(), { renew: false });

    expect(auth.api.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { disableCookieCache: true, disableRefresh: true },
      returnHeaders: true,
    });
  });

  it("rejects a disabled user without forwarding renewal cookies", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      headers: sessionHeaders(),
      response: session,
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: true,
      status: "SUSPENDED",
    } as never);

    const result = await getCurrentSessionWithHeaders(new Headers());

    expect(result.session).toBeNull();
    expect(result.headers.getSetCookie()).toEqual([]);
  });

  it("preserves cookie revocation headers when the session is revoked", async () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0");
    vi.mocked(auth.api.getSession).mockResolvedValue({
      headers,
      response: null,
    } as never);

    const result = await getCurrentSessionWithHeaders(new Headers());

    expect(result.session).toBeNull();
    expect(result.headers.getSetCookie()).toEqual([
      "session=; Path=/; HttpOnly; Max-Age=0",
    ]);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
