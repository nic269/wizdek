import { hasPermission } from "@repo/auth/permissions";
import { getCurrentSession } from "@repo/auth/session";
import { prisma } from "@repo/database";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

/**
 * What the signed-in user may do with a database connection. A connection in
 * another organization is treated like one that does not exist.
 */
export const requireConnectionAccess = async (connectionId: string) => {
  const session = await getCurrentSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }
  const connection = await prisma.databaseConnection.findUnique({
    select: { organizationId: true },
    where: { id: connectionId },
  });
  const can = (action: string) =>
    connection
      ? hasPermission({
          action,
          module: "databases",
          organizationId: connection.organizationId,
          userId: session.user.id,
        })
      : Promise.resolve(false);
  const [canRead, canManage, canBackup] = await Promise.all([
    can("read"),
    can("manage"),
    can("backup"),
  ]);
  if (!(connection && canRead)) {
    notFound();
  }
  return { canBackup, canManage };
};
