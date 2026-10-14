import { PageHeader } from "@repo/design-system";
import type { Metadata } from "next";
import { AppShellLayout } from "../../../app-shell-layout";
import { BackLink } from "../../../lib/back-link";
import { requireFlowAccess } from "../flow-access";
import { RunsPanel } from "./runs-panel";

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
      <PageHeader
        back={<BackLink href={`/flows/${flowId}`}>{flowName}</BackLink>}
        description="Every run of this flow, newest first."
        title="Runs"
      />
      <RunsPanel flowId={flowId} />
    </AppShellLayout>
  );
}
