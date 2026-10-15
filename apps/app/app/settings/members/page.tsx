import { getCurrentSession } from "@repo/auth/session";
import { authFeatureConfig } from "@repo/config";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShellLayout } from "../../app-shell-layout";
import { SettingsHeader } from "../settings-header";
import { MembersPanel } from "./members-panel";

export default async function MembersPage() {
  if (!authFeatureConfig.organizationInvitations) {
    notFound();
  }
  const session = await getCurrentSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <AppShellLayout>
      <SettingsHeader tab="members" />
      <MembersPanel currentUserId={session.user.id} />
    </AppShellLayout>
  );
}
