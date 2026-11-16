import { getCurrentSession } from "@repo/auth/session";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShellLayout } from "../../app-shell-layout";
import { SettingsHeader } from "../settings-header";
import { AccessPanel } from "./access-panel";

export const metadata: Metadata = { title: "Access" };

export default async function AccessPage() {
  const session = await getCurrentSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <AppShellLayout>
      <SettingsHeader tab="access" />
      <AccessPanel currentUserId={session.user.id} />
    </AppShellLayout>
  );
}
