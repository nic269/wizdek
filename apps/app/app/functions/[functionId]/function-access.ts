import { hasPermission } from "@repo/auth/permissions";
import { getCurrentSession } from "@repo/auth/session";
import { prisma } from "@repo/database";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

/**
 * What the signed-in user may do with a function. A function in another
 * organization is treated like one that does not exist.
 */
export const requireFunctionAccess = async (functionId: string) => {
  const session = await getCurrentSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }
  const fn = await prisma.codeFunction.findUnique({
    select: { organizationId: true },
    where: { id: functionId },
  });
  const can = (action: string) =>
    fn
      ? hasPermission({
          action,
          module: "functions",
          organizationId: fn.organizationId,
          userId: session.user.id,
        })
      : Promise.resolve(false);
  const [canRead, canManage, canRun] = await Promise.all([
    can("read"),
    can("manage"),
    can("run"),
  ]);
  if (!(fn && canRead)) {
    notFound();
  }
  return { canManage, canRun };
};
