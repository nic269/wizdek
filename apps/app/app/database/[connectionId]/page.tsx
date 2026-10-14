import type { Metadata } from "next";
import { AppShellLayout } from "../../app-shell-layout";
import { requireConnectionAccess } from "./connection-access";
import { ConnectionDetail } from "./connection-detail";

export const metadata: Metadata = { title: "Database connection" };

export default async function DatabaseConnectionPage({
  params,
}: {
  params: Promise<{ connectionId: string }>;
}) {
  const { connectionId } = await params;
  const { canBackup, canManage } = await requireConnectionAccess(connectionId);

  return (
    <AppShellLayout>
      <ConnectionDetail
        canBackup={canBackup}
        canManage={canManage}
        connectionId={connectionId}
      />
    </AppShellLayout>
  );
}
