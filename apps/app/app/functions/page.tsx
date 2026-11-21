import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShellLayout } from "../app-shell-layout";
import { FunctionsList } from "./functions-list";

export const metadata: Metadata = { title: "Functions" };

export default function FunctionsPage() {
  return (
    <AppShellLayout>
      <Suspense>
        <FunctionsList />
      </Suspense>
    </AppShellLayout>
  );
}
