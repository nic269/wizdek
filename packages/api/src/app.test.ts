import {
  createRole,
  listAuditLogs,
  listMembers,
  listRoles,
  PaginationCursorError,
  updateMemberRole,
} from "@repo/auth/access-control";
import {
  acceptInvitation,
  createInvitation,
  InvitationError,
  revokeInvitation,
} from "@repo/auth/invitations";
import {
  createOrganizationForUser,
  listOrganizationsForUser,
} from "@repo/auth/organizations";
import { hasPermission } from "@repo/auth/permissions";
import { auth } from "@repo/auth/server";
import { getCurrentSession } from "@repo/auth/session";
import { authFeatureConfig } from "@repo/config";
import { prisma } from "@repo/database";
import {
  assertMailProviderConfiguration,
  sendInvitationMail,
} from "@repo/mail";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "./app";
import { assertApiProviderConfiguration } from "./health";

vi.mock("@repo/auth/session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@repo/auth/keys", () => ({
  keys: () => ({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
}));
vi.mock("@repo/auth/server", () => ({
  auth: { handler: vi.fn(() => new Response(null, { status: 204 })) },
}));
vi.mock("@repo/auth/organizations", () => ({
  createOrganizationForUser: vi.fn(),
  isUniqueConstraintError: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002",
  listOrganizationsForUser: vi.fn(),
  normalizeOrganizationSlug: (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
}));
vi.mock("@repo/auth/invitations", () => ({
  acceptInvitation: vi.fn(),
  createInvitation: vi.fn(),
  InvitationError: class MockInvitationError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  listInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
}));
vi.mock("@repo/auth/access-control", () => ({
  createRole: vi.fn(),
  listAuditLogs: vi.fn(),
  listMembers: vi.fn(),
  listRoles: vi.fn(),
  PaginationCursorError: class MockPaginationCursorError extends Error {},
  updateMemberRole: vi.fn(),
}));
vi.mock("@repo/auth/permissions", () => ({ hasPermission: vi.fn() }));
vi.mock("@repo/database", () => ({
  prisma: { $queryRaw: vi.fn() },
}));
vi.mock("@repo/mail", () => ({
  assertMailProviderConfiguration: vi.fn(),
  getMailProviderStatus: () => ({
    configured: false,
    mode: "development",
    provider: "console",
    state: "disabled",
  }),
  sendInvitationMail: vi.fn(),
}));
vi.mock("@repo/storage", () => ({
  assertStorageProviderConfiguration: vi.fn(),
  getStorageProviderStatus: () => ({
    configured: true,
    mode: "local",
    provider: "local",
    state: "configured",
  }),
}));
vi.mock("@repo/jobs", () => ({
  getJobProviderStatus: () => ({
    configured: true,
    mode: "ephemeral",
    provider: "local",
    state: "configured",
  }),
}));

describe("api app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(authFeatureConfig as Record<string, boolean>, {
      organizationInvitations: true,
      passwordReset: true,
      requireEmailVerification: true,
    });
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("serves status", async () => {
    const response = await createApiApp().request("/status");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, service: "api" });
  });

  it("does not expose removed legacy RPC procedures", async () => {
    const response = await createApiApp().request("/rpc/status.get");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("serves readiness when required dependencies are healthy", async () => {
    const response = await createApiApp().request("/ready");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      checks: { database: { healthy: true } },
      ok: true,
      providers: {
        jobs: { configured: true, provider: "local" },
        mail: { configured: false, provider: "console", state: "disabled" },
        storage: { configured: true, provider: "local" },
      },
    });
  });

  it("uses auth delivery requirements for startup provider policy", () => {
    assertApiProviderConfiguration();

    expect(assertMailProviderConfiguration).toHaveBeenCalledWith({
      required: true,
    });
  });

  it.each([
    {
      flag: "passwordReset",
      message: "Password reset is not available.",
      method: "POST",
      path: "/api/auth/request-password-reset",
    },
    {
      flag: "passwordReset",
      message: "Password reset is not available.",
      method: "POST",
      path: "/api/auth/reset-password",
    },
    {
      flag: "passwordReset",
      message: "Password reset is not available.",
      method: "GET",
      path: "/api/auth/reset-password/reset-token",
    },
    {
      flag: "requireEmailVerification",
      message: "Email verification is not available.",
      method: "POST",
      path: "/api/auth/send-verification-email",
    },
    {
      flag: "requireEmailVerification",
      message: "Email verification is not available.",
      method: "POST",
      path: "/api/auth/verify-email",
    },
  ])("returns 404 for disabled Better Auth endpoint $path", async (feature) => {
    (authFeatureConfig as Record<string, boolean>)[feature.flag] = false;

    const response = await createApiApp().request(feature.path, {
      method: feature.method,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND", message: feature.message },
    });
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("keeps unrelated Better Auth endpoints mounted when features are disabled", async () => {
    Object.assign(authFeatureConfig as Record<string, boolean>, {
      passwordReset: false,
      requireEmailVerification: false,
    });

    const response = await createApiApp().request("/api/auth/sign-in/email", {
      method: "POST",
    });

    expect(response.status).toBe(204);
    expect(auth.handler).toHaveBeenCalledOnce();
  });

  it("fails production readiness when required mail is disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await createApiApp().request("/ready");

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "SERVICE_UNAVAILABLE",
        details: {
          providers: {
            mail: { healthy: false, required: true, state: "disabled" },
          },
        },
      },
    });
  });

  it("returns service unavailable when readiness dependencies fail", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(
      new Error("database unavailable")
    );

    const response = await createApiApp().request("/ready");

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "SERVICE_UNAVAILABLE",
        details: { checks: { database: { healthy: false } } },
      },
    });
  });

  it("returns standard structured errors for unknown routes", async () => {
    const response = await createApiApp().request("/rpc/missing.get", {
      headers: { "x-request-id": "req-rpc-missing" },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND", requestId: "req-rpc-missing" },
    });
  });

  it("does not expose unknown error details", async () => {
    const internalMessage = "postgresql://secret-host/internal-database";
    const errorSink = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.mocked(auth.handler).mockRejectedValueOnce(new Error(internalMessage));

    try {
      const response = await createApiApp().request("/api/auth/sign-in/email", {
        headers: { "x-request-id": "req-unhandled" },
        method: "POST",
      });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred.",
          requestId: "req-unhandled",
        },
      });
      expect(JSON.stringify(body)).not.toContain(internalMessage);
      expect(errorSink).toHaveBeenCalledWith(
        "[error] api.unhandled_error",
        expect.objectContaining({
          errorMessage: internalMessage,
          errorStack: expect.stringContaining(internalMessage),
          message: "api.unhandled_error",
        })
      );
    } finally {
      errorSink.mockRestore();
    }
  });

  it("does not expose unknown oRPC procedure error details", async () => {
    const internalMessage = "postgresql://secret-host/orpc-database";
    const errorSink = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.mocked(getCurrentSession).mockRejectedValueOnce(
      new Error(internalMessage)
    );

    try {
      const response = await createApiApp().request("/api/organizations", {
        headers: { "x-request-id": "req-orpc-unhandled" },
      });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred.",
          requestId: "req-orpc-unhandled",
        },
      });
      expect(JSON.stringify(body)).not.toContain(internalMessage);
      expect(errorSink).toHaveBeenCalledWith(
        "[error] api.unhandled_error",
        expect.objectContaining({
          errorMessage: internalMessage,
          errorStack: expect.stringContaining(internalMessage),
          message: "api.unhandled_error",
        })
      );
    } finally {
      errorSink.mockRestore();
    }
  });

  it("publishes OpenAPI paths from the contract registry", async () => {
    const response = await createApiApp().request("/openapi.json");
    expect(response.status).toBe(200);
    const document = await response.json();
    expect(document.paths["/status"].get.operationId).toBe("status.get.rest");
    expect(document.paths["/rpc/status.get"]).toBeUndefined();
  });

  it("exposes optional provider statuses", async () => {
    const files = await createApiApp().request("/api/files");
    const jobs = await createApiApp().request("/api/jobs");

    expect(files.status).toBe(200);
    expect(await files.json()).toMatchObject({
      data: { configured: true, provider: "local" },
    });
    expect(jobs.status).toBe(200);
    expect(await jobs.json()).toMatchObject({
      data: { configured: true, provider: "local" },
    });
  });

  it("rejects anonymous organization access", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    const response = await createApiApp().request("/api/organizations");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("rejects users that the shared session helper treats as inactive", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);

    const response = await createApiApp().request(
      "/api/organizations/org-1/roles"
    );

    expect(response.status).toBe(401);
    expect(hasPermission).not.toHaveBeenCalled();
    expect(listRoles).not.toHaveBeenCalled();
  });

  it("lists only organizations returned for the authenticated user", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(listOrganizationsForUser).mockResolvedValue([
      {
        id: "org-1",
        memberships: [{ role: { name: "Owner" } }],
        name: "Acme",
        slug: "acme",
      },
    ]);

    const response = await createApiApp().request("/api/organizations");
    expect(response.status).toBe(200);
    expect(listOrganizationsForUser).toHaveBeenCalledWith("user-1");
    expect(await response.json()).toEqual({
      data: [{ id: "org-1", name: "Acme", role: "Owner", slug: "acme" }],
    });
  });

  it("creates an organization for the authenticated user", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(createOrganizationForUser).mockResolvedValue({
      id: "org-1",
      name: "Acme Studio",
      role: "Owner",
      slug: "acme-studio",
    });

    const response = await createApiApp().request("/api/organizations", {
      body: JSON.stringify({ name: "Acme Studio" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(createOrganizationForUser).toHaveBeenCalledWith({
      name: "Acme Studio",
      slug: "acme-studio",
      userId: "user-1",
    });
  });

  it("normalizes contract input validation to the API error envelope", async () => {
    const response = await createApiApp().request("/api/organizations", {
      body: JSON.stringify({ name: "x" }),
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-validation",
      },
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", requestId: "req-validation" },
    });
  });

  it("prevents members without invite permission from creating invitations", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(false);

    const response = await createApiApp().request(
      "/api/organizations/org-1/invitations",
      {
        body: JSON.stringify({ email: "member@example.com" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    );
    expect(response.status).toBe(403);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it.each([
    {
      body: undefined,
      method: "GET",
      path: "/api/organizations/org-1/invitations",
    },
    {
      body: JSON.stringify({ email: "member@example.com" }),
      method: "POST",
      path: "/api/organizations/org-1/invitations",
    },
    {
      body: undefined,
      method: "DELETE",
      path: "/api/organizations/org-1/invitations/invite-1",
    },
    {
      body: JSON.stringify({ token: "a".repeat(43) }),
      method: "POST",
      path: "/api/invitations/accept",
    },
  ])("returns 404 for disabled invitation route $method $path", async (request) => {
    (
      authFeatureConfig as { organizationInvitations: boolean }
    ).organizationInvitations = false;

    const response = await createApiApp().request(request.path, {
      ...(request.body ? { body: request.body } : {}),
      headers: { "content-type": "application/json" },
      method: request.method,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "Organization invitations are not available.",
      },
    });
    expect(getCurrentSession).not.toHaveBeenCalled();
  });

  it("creates and delivers an invitation for an authorized owner", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "owner-1", name: "Ada Owner" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(createInvitation).mockResolvedValue({
      invitation: {
        email: "member@example.com",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        id: "invite-1",
        status: "PENDING",
      } as never,
      organizationName: "Acme",
      token: "a".repeat(43),
    });
    vi.mocked(sendInvitationMail).mockResolvedValue({
      id: "mail-1",
      provider: "console",
    });

    const response = await createApiApp().request(
      "/api/organizations/org-1/invitations",
      {
        body: JSON.stringify({ email: "member@example.com" }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        method: "POST",
      }
    );

    expect(response.status).toBe(201);
    expect(sendInvitationMail).toHaveBeenCalledWith({
      inviterName: "Ada Owner",
      inviteUrl: expect.stringContaining("http://localhost:3000/invite/"),
      organizationName: "Acme",
      to: "member@example.com",
    });
    expect(JSON.stringify(await response.json())).not.toContain("tokenHash");
  });

  it("returns conflict when revoking an invitation that is not pending", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "owner-1" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(revokeInvitation).mockRejectedValue(
      new InvitationError(
        "INVITATION_NOT_PENDING",
        "Only pending invitations can be revoked."
      )
    );

    const response = await createApiApp().request(
      "/api/organizations/org-1/invitations/invite-1",
      {
        headers: { "x-request-id": "req-revoke" },
        method: "DELETE",
      }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: "INVITATION_NOT_PENDING",
        message: "Only pending invitations can be revoked.",
        requestId: "req-revoke",
      },
    });
  });

  it("binds invitation acceptance to the authenticated user", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { email: "member@example.com", id: "user-1" },
    } as never);
    vi.mocked(acceptInvitation).mockResolvedValue({
      id: "org-1",
      name: "Acme",
      slug: "acme",
    });

    const response = await createApiApp().request("/api/invitations/accept", {
      body: JSON.stringify({ token: "a".repeat(43) }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(acceptInvitation).toHaveBeenCalledWith({
      token: "a".repeat(43),
      userEmail: "member@example.com",
      userId: "user-1",
    });
  });

  it("requires role read permission before listing roles", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(false);

    const response = await createApiApp().request(
      "/api/organizations/org-1/roles"
    );

    expect(response.status).toBe(403);
    expect(hasPermission).toHaveBeenCalledWith({
      action: "read",
      module: "roles",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(listRoles).not.toHaveBeenCalled();
  });

  it("creates roles through catalog permissions and audit-aware service", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "owner-1" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(createRole).mockResolvedValue({
      _count: { memberships: 0 },
      description: null,
      id: "role-1",
      name: "Manager",
      permissions: [{ action: "read", module: "members" }],
    } as never);

    const response = await createApiApp().request(
      "/api/organizations/org-1/roles",
      {
        body: JSON.stringify({
          name: "Manager",
          permissions: [{ action: "read", module: "members" }],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    );

    expect(response.status).toBe(201);
    expect(createRole).toHaveBeenCalledWith({
      actorId: "owner-1",
      name: "Manager",
      organizationId: "org-1",
      permissions: [{ action: "read", module: "members" }],
    });
  });

  it("updates member roles inside the organization boundary", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "owner-1" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(updateMemberRole).mockResolvedValue(undefined);

    const response = await createApiApp().request(
      "/api/organizations/org-1/members/member-1/role",
      {
        body: JSON.stringify({ roleId: "role-2" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }
    );

    expect(response.status).toBe(204);
    expect(updateMemberRole).toHaveBeenCalledWith({
      actorId: "owner-1",
      membershipId: "member-1",
      organizationId: "org-1",
      roleId: "role-2",
    });
  });

  it("returns conflict when a role update would remove the last active owner", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "owner-1" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(updateMemberRole).mockRejectedValue(
      new Error("LAST_OWNER_REQUIRED")
    );

    const response = await createApiApp().request(
      "/api/organizations/org-1/members/member-1/role",
      {
        body: JSON.stringify({ roleId: "role-2" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: "CONFLICT",
        message: "An organization must keep at least one active Owner.",
      },
    });
  });

  it.each([
    {
      code: "OWNER_ROLE_REQUIRES_OWNER",
      expectedCode: "FORBIDDEN",
      expectedStatus: 403,
    },
    {
      code: "OWNER_UPDATE_CONFLICT",
      expectedCode: "CONFLICT",
      expectedStatus: 409,
    },
  ])("maps $code role update failures", async (failure) => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "owner-1" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(updateMemberRole).mockRejectedValue(new Error(failure.code));

    const response = await createApiApp().request(
      "/api/organizations/org-1/members/member-1/role",
      {
        body: JSON.stringify({ roleId: "role-2" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }
    );

    expect(response.status).toBe(failure.expectedStatus);
    expect(await response.json()).toMatchObject({
      error: { code: failure.expectedCode },
    });
  });

  it("requires audit read permission before exposing audit logs", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(listAuditLogs).mockResolvedValue({
      items: [
        {
          action: "role.created",
          actor: null,
          createdAt: new Date("2030-01-01T00:00:00.000Z"),
          id: "audit-1",
          metadata: null,
          targetId: "role-1",
          targetType: "Role",
        },
      ],
      nextCursor: null,
    } as never);

    const response = await createApiApp().request(
      "/api/organizations/org-1/audit-logs"
    );

    expect(response.status).toBe(200);
    expect(hasPermission).toHaveBeenCalledWith({
      action: "read",
      module: "audit",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(listAuditLogs).toHaveBeenCalledWith({
      limit: 20,
      organizationId: "org-1",
    });
  });

  it("lists members through member read permission", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(listMembers).mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    const response = await createApiApp().request(
      "/api/organizations/org-1/members"
    );

    expect(response.status).toBe(200);
    expect(listMembers).toHaveBeenCalledWith({
      limit: 20,
      organizationId: "org-1",
    });
  });

  it("normalizes malformed pagination cursors to a validation error", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(listMembers).mockRejectedValue(new PaginationCursorError());

    const response = await createApiApp().request(
      "/api/organizations/org-1/members?cursor=invalid"
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});
