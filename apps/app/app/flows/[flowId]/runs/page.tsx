import { buttonVariants, PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../../../app-shell-layout";
import { requireFlowAccess } from "../flow-access";
import { RunsPanel } from "./runs-panel";

export default async function FlowRunsPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  const { flowName } = await requireFlowAccess(flowId);

  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          actions={
            <a
              className={buttonVariants({ variant: "outline" })}
              href={`/flows/${flowId}`}
            >
              Open flow
            </a>
          }
          description="Every run of this flow, newest first."
          title={`Runs of ${flowName}`}
        />
        <RunsPanel flowId={flowId} />
      </div>
    </AppShellLayout>
  );
}
