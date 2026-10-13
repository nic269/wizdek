import { hasPermission } from "@repo/auth/permissions";
import { getCurrentSession } from "@repo/auth/session";
import { prisma } from "@repo/database";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

/**
 * What the signed-in user may do with a flow. A flow in another organization
 * is treated like one that does not exist.
 */
export const requireFlowAccess = async (flowId: string) => {
  const session = await getCurrentSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }
  const flow = await prisma.flow.findUnique({
    select: { name: true, organizationId: true },
    where: { id: flowId },
  });
  const can = (action: string) =>
    flow
      ? hasPermission({
          action,
          module: "flows",
          organizationId: flow.organizationId,
          userId: session.user.id,
        })
      : Promise.resolve(false);
  const [canRead, canManage, canRun] = await Promise.all([
    can("read"),
    can("manage"),
    can("run"),
  ]);
  if (!(flow && canRead)) {
    notFound();
  }
  return { canManage, canRun, flowName: flow.name };
};
