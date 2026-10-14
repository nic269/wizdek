import type { Metadata } from "next";
import { AppShellLayout } from "../app-shell-layout";
import { ConnectionsPanel } from "./connections-panel";

export const metadata: Metadata = { title: "Database" };

export default function DatabasePage() {
  return (
    <AppShellLayout>
      <ConnectionsPanel />
    </AppShellLayout>
  );
}
