import { prisma } from "@repo/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "./server";
import {
  canUseAuthenticatedSession,
  getCurrentSession,
  isAuthenticated,
} from "./session";

vi.mock("@repo/database", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock("./server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const session = {
  session: { id: "session-1", userId: "user-1" },
  user: { email: "user@example.com", id: "user-1", name: "User" },
};

describe("session helpers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns active user sessions", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: true,
      status: "ACTIVE",
    } as never);

    await expect(getCurrentSession(new Headers())).resolves.toEqual(session);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      select: { emailVerified: true, status: true },
      where: { id: "user-1" },
    });
  });

  it.each([
    "INVITED",
    "SUSPENDED",
  ] as const)("returns null for %s users", async (status) => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: true,
      status,
    } as never);

    await expect(getCurrentSession(new Headers())).resolves.toBeNull();
  });

  it("returns null when the session user no longer exists", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(getCurrentSession(new Headers())).resolves.toBeNull();
  });

  it("returns null for active users with unverified email", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: false,
      status: "ACTIVE",
    } as never);

    await expect(getCurrentSession(new Headers())).resolves.toBeNull();
  });

  it("allows active unverified users when verification is disabled", () => {
    expect(
      canUseAuthenticatedSession(
        { emailVerified: false, status: "ACTIVE" },
        false
      )
    ).toBe(true);
  });

  it("does not query user status when Better Auth has no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    await expect(getCurrentSession(new Headers())).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("treats only user-bearing sessions as authenticated", () => {
    expect(isAuthenticated(session as never)).toBe(true);
    expect(isAuthenticated(null)).toBe(false);
    expect(isAuthenticated({ user: null } as never)).toBe(false);
  });
});
