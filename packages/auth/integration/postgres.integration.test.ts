import { randomUUID } from "node:crypto";
import { prisma, syncSystemRoles } from "@repo/database";
import { isRetryableTransactionConflict } from "@repo/database/transaction-conflicts";
import { afterEach, describe, expect, it } from "vitest";
import { updateMemberRole } from "../src/access-control";
import { acceptInvitation, hashInvitationToken } from "../src/invitations";

const organizationIds: string[] = [];
const userIds: string[] = [];

const createOrganization = async () => {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Integration ${suffix}`, slug: `integration-${suffix}` },
  });
  organizationIds.push(organization.id);
  const roles = await prisma.$transaction((transaction) =>
    syncSystemRoles(transaction, organization.id)
  );
  return { organization, roles };
};

const createUser = async (label: string) => {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `${label}-${suffix}@example.com`,
      emailVerified: true,
      name: label,
      status: "ACTIVE",
    },
  });
  userIds.push(user.id);
  return user;
};

afterEach(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: organizationIds.splice(0) } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

describe("PostgreSQL organization integrity", () => {
  it("classifies a synchronized real adapter serialization conflict", async () => {
    const { organization } = await createOrganization();
    let readyCount = 0;
    let releaseTransactions: (() => void) | undefined;
    const bothTransactionsReady = new Promise<void>((resolve) => {
      releaseTransactions = resolve;
    });
    const updateOrganization = (name: string) =>
      prisma.$transaction(
        async (transaction) => {
          await transaction.organization.findUniqueOrThrow({
            select: { id: true },
            where: { id: organization.id },
          });
          readyCount += 1;
          if (readyCount === 2) {
            releaseTransactions?.();
          }
          await bothTransactionsReady;
          return transaction.organization.update({
            data: { name },
            where: { id: organization.id },
          });
        },
        { isolationLevel: "Serializable" }
      );

    const results = await Promise.allSettled([
      updateOrganization("Serializable A"),
      updateOrganization("Serializable B"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    if (rejected?.status === "rejected") {
      expect(isRetryableTransactionConflict(rejected.reason)).toBe(true);
    }
  });

  it("classifies a synchronized real adapter deadlock conflict", async () => {
    const [{ organization: organizationA }, { organization: organizationB }] =
      await Promise.all([createOrganization(), createOrganization()]);
    let readyCount = 0;
    let releaseTransactions: (() => void) | undefined;
    const bothTransactionsReady = new Promise<void>((resolve) => {
      releaseTransactions = resolve;
    });
    const updateOrganizations = (firstId: string, secondId: string) =>
      prisma.$transaction(async (transaction) => {
        await transaction.organization.update({
          data: { name: `First ${firstId}` },
          where: { id: firstId },
        });
        readyCount += 1;
        if (readyCount === 2) {
          releaseTransactions?.();
        }
        await bothTransactionsReady;
        return transaction.organization.update({
          data: { name: `Second ${secondId}` },
          where: { id: secondId },
        });
      });

    const results = await Promise.allSettled([
      updateOrganizations(organizationA.id, organizationB.id),
      updateOrganizations(organizationB.id, organizationA.id),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    if (rejected?.status === "rejected") {
      expect(isRetryableTransactionConflict(rejected.reason)).toBe(true);
    }
  });

  it("preserves one Owner during concurrent demotions", async () => {
    const { organization, roles } = await createOrganization();
    const [ownerA, ownerB] = await Promise.all([
      createUser("owner-a"),
      createUser("owner-b"),
    ]);
    const memberships = await Promise.all(
      [ownerA, ownerB].map((user) =>
        prisma.membership.create({
          data: {
            organizationId: organization.id,
            roleId: roles.Owner.id,
            status: "ACTIVE",
            userId: user.id,
          },
        })
      )
    );

    const results = await Promise.allSettled([
      updateMemberRole({
        actorId: ownerA.id,
        membershipId: memberships[0].id,
        organizationId: organization.id,
        roleId: roles.Member.id,
      }),
      updateMemberRole({
        actorId: ownerB.id,
        membershipId: memberships[1].id,
        organizationId: organization.id,
        roleId: roles.Member.id,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    if (rejected?.status === "rejected") {
      expect(["LAST_OWNER_REQUIRED", "OWNER_UPDATE_CONFLICT"]).toContain(
        rejected.reason.code
      );
    }
    await expect(
      prisma.membership.count({
        where: {
          organizationId: organization.id,
          role: { isSystem: true, name: "Owner" },
          status: "ACTIVE",
        },
      })
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: "member.role_updated",
          organizationId: organization.id,
        },
      })
    ).resolves.toBe(1);
  });

  it("persists invitation expiration before surfacing the error", async () => {
    const { organization } = await createOrganization();
    const user = await createUser("invitee");
    const token = randomUUID();
    const invitation = await prisma.invitation.create({
      data: {
        email: user.email,
        expiresAt: new Date("2028-01-01T00:00:00.000Z"),
        organizationId: organization.id,
        tokenHash: hashInvitationToken(token),
      },
    });

    await expect(
      acceptInvitation({
        now: new Date("2029-01-01T00:00:00.000Z"),
        token,
        userEmail: user.email,
        userId: user.id,
      })
    ).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    await expect(
      prisma.invitation.findUnique({
        select: { status: true },
        where: { id: invitation.id },
      })
    ).resolves.toEqual({ status: "EXPIRED" });
  });

  it("rejects orphan integrations and cascades organization-owned rows", async () => {
    await expect(
      prisma.integrationConnection.create({
        data: {
          displayName: "Orphan",
          organizationId: `missing-${randomUUID()}`,
          provider: "test",
        },
      })
    ).rejects.toMatchObject({ code: "P2003" });

    const { organization } = await createOrganization();
    const connection = await prisma.integrationConnection.create({
      data: {
        displayName: "Owned",
        organizationId: organization.id,
        provider: "test",
      },
    });
    await prisma.organization.delete({ where: { id: organization.id } });
    organizationIds.splice(organizationIds.indexOf(organization.id), 1);

    await expect(
      prisma.integrationConnection.findUnique({ where: { id: connection.id } })
    ).resolves.toBeNull();
  });
});
