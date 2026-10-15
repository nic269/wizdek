import { getCurrentSession } from "@repo/auth/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShellLayout } from "../app-shell-layout";
import { GeneralSettings } from "./general-settings";
import { SettingsHeader } from "./settings-header";

export default async function SettingsPage() {
  const session = await getCurrentSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <AppShellLayout>
      <SettingsHeader tab="general" />
      <GeneralSettings
        user={{
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          name: session.user.name,
        }}
      />
    </AppShellLayout>
  );
}
