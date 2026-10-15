import { getCurrentSession } from "@repo/auth/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShellLayout } from "../../app-shell-layout";
import { SettingsHeader } from "../settings-header";
import { AccessPanel } from "./access-panel";

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
