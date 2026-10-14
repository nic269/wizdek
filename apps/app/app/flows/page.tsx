import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShellLayout } from "../app-shell-layout";
import { FlowsPanel } from "./flows-panel";

export const metadata: Metadata = { title: "Flows" };

export default function FlowsPage() {
  return (
    <AppShellLayout>
      <Suspense>
        <FlowsPanel />
      </Suspense>
    </AppShellLayout>
  );
}
