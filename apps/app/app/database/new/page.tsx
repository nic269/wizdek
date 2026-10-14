import type { Metadata } from "next";
import { AppShellLayout } from "../../app-shell-layout";
import { ConnectionsPanel } from "../connections-panel";

export const metadata: Metadata = { title: "Add a database connection" };

/** The connection list with the add-connection sheet already open. */
export default function NewDatabaseConnectionPage() {
  return (
    <AppShellLayout>
      <ConnectionsPanel startAdding />
    </AppShellLayout>
  );
}
