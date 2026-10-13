import { getCurrentSession } from "@repo/auth/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShellLayout } from "../app-shell-layout";
import { ConsoleLoader } from "./console-loader";

export default async function GraphqlConsolePage() {
  const session = await getCurrentSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <AppShellLayout>
      <ConsoleLoader userId={session.user.id} />
    </AppShellLayout>
  );
}
