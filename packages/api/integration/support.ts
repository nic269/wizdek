import { randomUUID } from "node:crypto";
import { getCurrentSession } from "@repo/auth/session";
import { prisma, syncSystemRoles } from "@repo/database";
import { vi } from "vitest";
import { createApiApp } from "../src/app";

export interface Actor {
  organizationId: string;
  userId: string;
}

export type TestOrganization = Awaited<
  ReturnType<ReturnType<typeof createApiHarness>["createOrganization"]>
>;

/**
 * Drives the real API app against Postgres. The test file must mock
 * `@repo/auth/session`; everything else, permissions included, is real.
 */
export const createApiHarness = () => {
  const app = createApiApp();
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  /** Every response body seen, for scanning that no secret was returned. */
  const responseBodies: string[] = [];

  const createUser = async (label: string) => {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${randomUUID()}@example.com`,
        emailVerified: true,
        name: label,
        status: "ACTIVE",
      },
    });
    userIds.push(user.id);
    return user.id;
  };

  const createOrganization = async () => {
    const suffix = randomUUID();
    const organization = await prisma.organization.create({
      data: { name: `Test ${suffix}`, slug: `test-${suffix}` },
    });
    organizationIds.push(organization.id);
    const roles = await prisma.$transaction((transaction) =>
      syncSystemRoles(transaction, organization.id)
    );
    return { organizationId: organization.id, roles };
  };

  const createActor = async (
    role: "Owner" | "Member" | "Viewer",
    existing?: Awaited<ReturnType<typeof createOrganization>>
  ): Promise<Actor> => {
    const { organizationId, roles } = existing ?? (await createOrganization());
    const userId = await createUser(role.toLowerCase());
    await prisma.membership.create({
      data: { organizationId, roleId: roles[role].id, userId },
    });
    return { organizationId, userId };
  };

  /** A member whose custom role holds exactly the given permissions. */
  const createActorWithPermissions = async (
    organizationId: string,
    permissions: { action: string; module: string }[]
  ): Promise<Actor> => {
    const userId = await createUser("custom");
    const role = await prisma.role.create({
      data: {
        name: `Custom ${randomUUID()}`,
        organizationId,
        permissions: { createMany: { data: permissions } },
      },
    });
    await prisma.membership.create({
      data: { organizationId, roleId: role.id, userId },
    });
    return { organizationId, userId };
  };

  const call = async (
    actor: Pick<Actor, "userId"> | null,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) => {
    vi.mocked(getCurrentSession).mockResolvedValue(
      actor ? ({ user: { id: actor.userId } } as never) : null
    );
    const response = await app.request(path, {
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    responseBodies.push(text);
    return {
      // biome-ignore lint/suspicious/noExplicitAny: responses are asserted field by field
      json: (text ? JSON.parse(text) : null) as any,
      status: response.status,
    };
  };

  const cleanup = async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds.splice(0) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  };

  return {
    call,
    cleanup,
    createActor,
    createActorWithPermissions,
    createOrganization,
    responseBodies,
  };
};
