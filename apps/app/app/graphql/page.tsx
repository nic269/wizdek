import { getCurrentSession } from "@repo/auth/session";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShellLayout } from "../app-shell-layout";
import { ConsoleGate } from "./console-gate";

export const metadata: Metadata = { title: "GraphQL" };

export default async function GraphqlConsolePage() {
  const session = await getCurrentSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <AppShellLayout width="full">
      <ConsoleGate userId={session.user.id} />
    </AppShellLayout>
  );
}
