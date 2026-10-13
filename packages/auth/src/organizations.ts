import { prisma, syncSystemRoles } from "@repo/database";

export const normalizeOrganizationSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const listOrganizationsForUser = (userId: string) =>
  prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      memberships: {
        select: { role: { select: { name: true } } },
        take: 1,
        where: { userId },
      },
      name: true,
      slug: true,
    },
    where: {
      memberships: {
        some: { status: "ACTIVE", userId },
      },
    },
  });

export const createOrganizationForUser = async (input: {
  userId: string;
  name: string;
  slug: string;
}) =>
  prisma.$transaction(async (transaction) => {
    const organization = await transaction.organization.create({
      data: {
        name: input.name.trim(),
        slug: normalizeOrganizationSlug(input.slug),
      },
      select: { id: true, name: true, slug: true },
    });

    const { Owner: ownerRole } = await syncSystemRoles(
      transaction,
      organization.id
    );

    await transaction.membership.create({
      data: {
        organizationId: organization.id,
        roleId: ownerRole.id,
        status: "ACTIVE",
        userId: input.userId,
      },
    });

    await transaction.auditLog.create({
      data: {
        action: "organization.created",
        actorId: input.userId,
        metadata: { name: organization.name, slug: organization.slug },
        organizationId: organization.id,
        targetId: organization.id,
        targetType: "Organization",
      },
    });

    return { ...organization, role: ownerRole.name };
  });

export const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";
