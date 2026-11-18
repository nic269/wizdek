import type { Metadata } from "next";
import { AppShellLayout } from "../../app-shell-layout";
import { requireFunctionAccess } from "./function-access";
import { FunctionWorkbench } from "./function-workbench";

export const metadata: Metadata = { title: "Function" };

export default async function FunctionPage({
  params,
}: {
  params: Promise<{ functionId: string }>;
}) {
  const { functionId } = await params;
  const { canManage, canRun } = await requireFunctionAccess(functionId);

  return (
    <AppShellLayout width="full">
      <FunctionWorkbench
        canManage={canManage}
        canRun={canRun}
        functionId={functionId}
      />
    </AppShellLayout>
  );
}
