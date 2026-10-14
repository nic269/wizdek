import { getCurrentSession } from "@repo/auth/session";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShellLayout } from "../app-shell-layout";
import { DashboardOverview } from "./dashboard-overview";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getCurrentSession(await headers());

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <AppShellLayout>
      <DashboardOverview userName={session.user.name} />
    </AppShellLayout>
  );
}
