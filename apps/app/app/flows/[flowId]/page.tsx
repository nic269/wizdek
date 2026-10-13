import { hasPermission } from "@repo/auth/permissions";
import { getCurrentSession } from "@repo/auth/session";
import { prisma } from "@repo/database";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShellLayout } from "../../app-shell-layout";
import { FlowBuilderLoader } from "./flow-builder-loader";

export default async function FlowBuilderPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const session = await getCurrentSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }
  const { flowId } = await params;
  const flow = await prisma.flow.findUnique({
    select: { organizationId: true },
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
  // A flow in another organization looks the same as one that does not exist.
  if (!(flow && canRead)) {
    notFound();
  }

  return (
    <AppShellLayout>
      <FlowBuilderLoader
        canManage={canManage}
        canRun={canRun}
        flowId={flowId}
      />
    </AppShellLayout>
  );
}
