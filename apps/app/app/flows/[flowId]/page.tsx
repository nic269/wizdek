import type { Metadata } from "next";
import { AppShellLayout } from "../../app-shell-layout";
import { requireFlowAccess } from "./flow-access";
import { FlowBuilderLoader } from "./flow-builder-loader";

export const metadata: Metadata = { title: "Flow builder" };

export default async function FlowBuilderPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  const { canManage, canRun } = await requireFlowAccess(flowId);

  return (
    <AppShellLayout width="full">
      <FlowBuilderLoader
        canManage={canManage}
        canRun={canRun}
        flowId={flowId}
      />
    </AppShellLayout>
  );
}
