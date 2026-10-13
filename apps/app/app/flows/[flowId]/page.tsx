import { AppShellLayout } from "../../app-shell-layout";
import { requireFlowAccess } from "./flow-access";
import { FlowBuilderLoader } from "./flow-builder-loader";

export default async function FlowBuilderPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  const { canManage, canRun } = await requireFlowAccess(flowId);

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
