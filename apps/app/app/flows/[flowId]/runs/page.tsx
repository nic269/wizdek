import { PageHeader } from "@repo/design-system";
import type { Metadata } from "next";
import { AppShellLayout } from "../../../app-shell-layout";
import { requireFlowAccess } from "../flow-access";
import { RunsHeader, RunsPanel } from "./runs-panel";

export const metadata: Metadata = { title: "Runs" };

export default async function FlowRunsPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  const { flowName } = await requireFlowAccess(flowId);

  return (
    <AppShellLayout>
      <RunsHeader flowId={flowId} flowName={flowName} />
      <PageHeader
        description={`Every run of ${flowName}, newest first.`}
        title="Runs"
      />
      <RunsPanel flowId={flowId} />
    </AppShellLayout>
  );
}
