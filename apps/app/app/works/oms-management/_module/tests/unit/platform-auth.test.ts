import { getCurrentSessionWithHeaders } from "@repo/auth/session";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../server/config";
import { guard } from "../../server/http/guard";
import { requireCapability } from "../../server/identity/access-policy";
import { requireIdentity } from "../../server/identity/wizdek-session";

vi.mock("@repo/auth/session", () => ({
  getCurrentSessionWithHeaders: vi.fn(),
}));
vi.mock("../../server/config", () => ({ getConfig: () => config }));
vi.mock("../../server/storage/control-store", () => ({
  controlStore: () => ({ audit: vi.fn() }),
}));

const actor = {
  email: "operator@example.com",
  id: "operator-1",
  name: "Operator",
};
const config = {
  allowedUsers: new Set([actor.id]),
  allowLoopback: true,
  apiOrigins: new Set<string>(),
  backupEvidence: {},
  controlPath: ".data/test/control.sqlite",
  dbHosts: new Set<string>(),
  dbPorts: new Set([5432]),
  encryptionKey: Buffer.alloc(32).toString("base64"),
  identityOrigin: "http://127.0.0.1:3002",
  policy: [],
  poolLimit: 1,
  profileScopes: {},
  publicOrigin: "http://127.0.0.1:4000",
  targetBindings: [],
} satisfies Config;

const platformSession = (expiresAt: Date) => ({
  session: {
    expiresAt,
    id: "session-1",
    token: "not-exposed",
    userId: actor.id,
  },
  user: actor,
});

function cookieHeaders(...cookies: string[]) {
  const headers = new Headers();
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return headers;
}

describe("native OMS platform authentication", () => {
  beforeEach(() => {
    config.allowedUsers.add(actor.id);
    vi.clearAllMocks();
  });

  it("accepts a current allowlisted Wizdek session without renewing it", async () => {
    vi.mocked(getCurrentSessionWithHeaders).mockResolvedValue({
      headers: new Headers(),
      session: platformSession(new Date("2099-01-01T00:00:00.000Z")) as never,
    });
    const request = new Request(
      "http://localhost/works/oms-management/api/profiles",
      {
        headers: { cookie: "better-auth.session_token=fixture" },
      }
    );

    await expect(requireIdentity(request, config)).resolves.toEqual(actor);
    expect(getCurrentSessionWithHeaders).toHaveBeenCalledWith(request.headers, {
      renew: false,
    });
  });

  it("rejects an expired Wizdek session", async () => {
    vi.mocked(getCurrentSessionWithHeaders).mockResolvedValue({
      headers: cookieHeaders(
        "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly",
        "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly"
      ),
      session: platformSession(new Date("2000-01-01T00:00:00.000Z")) as never,
    });

    const response = await guard(
      new Request("http://localhost/works/oms-management"),
      () => Response.json({ ok: true })
    );

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly",
      "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly",
    ]);
  });

  it("rejects disabled or revoked users when the platform helper returns null", async () => {
    vi.mocked(getCurrentSessionWithHeaders).mockResolvedValue({
      headers: cookieHeaders(
        "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly"
      ),
      session: null,
    });

    const response = await guard(
      new Request("http://localhost/works/oms-management"),
      () => Response.json({ ok: true })
    );

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly",
    ]);
  });

  it("preserves platform auth headers when app access policy denies an active session", async () => {
    vi.mocked(getCurrentSessionWithHeaders).mockResolvedValue({
      headers: cookieHeaders(
        "better-auth.session_token=rotated; Path=/; HttpOnly"
      ),
      session: platformSession(new Date("2099-01-01T00:00:00.000Z")) as never,
    });

    config.allowedUsers.delete(actor.id);
    const response = await guard(
      new Request("http://localhost/works/oms-management"),
      () => Response.json({ ok: true })
    );
    config.allowedUsers.add(actor.id);

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.session_token=rotated; Path=/; HttpOnly",
    ]);
  });

  it("denies management capabilities not granted by app policy", () => {
    expect(() =>
      requireCapability(
        actor,
        { id: "production", safetyClass: "production" },
        "settings:write",
        config
      )
    ).toThrowError(expect.objectContaining({ code: "forbidden", status: 403 }));
  });
});
