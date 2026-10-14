import type { Metadata } from "next";
import { AppShellLayout } from "../../../../app-shell-layout";
import { requireFlowAccess } from "../../flow-access";
import { RunTraceLoader } from "./run-trace-loader";

export const metadata: Metadata = { title: "Run trace" };

export default async function FlowRunPage({
  params,
}: {
  params: Promise<{ flowId: string; runId: string }>;
}) {
  const { flowId, runId } = await params;
  const { canRun, flowName } = await requireFlowAccess(flowId);

  return (
    <AppShellLayout width="full">
      <RunTraceLoader
        canRun={canRun}
        flowId={flowId}
        flowName={flowName}
        runId={runId}
      />
    </AppShellLayout>
  );
}
