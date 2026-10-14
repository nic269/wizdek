import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShellLayout } from "../app-shell-layout";
import { StoresPanel } from "./stores-panel";

export const metadata: Metadata = { title: "Stores" };

export default function StoresPage() {
  return (
    <AppShellLayout>
      <Suspense>
        <StoresPanel />
      </Suspense>
    </AppShellLayout>
  );
}
