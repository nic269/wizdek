import { getCurrentSession } from "@repo/auth/session";
import { Page } from "@repo/design-system";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { WizdekShell } from "./shell/wizdek-shell";

interface AppShellLayoutProps {
  children: ReactNode;
  /**
   * `default` and `narrow` pad and centre the page; `full` gives the page the
   * whole panel, for the flow builder, the console and the run trace.
   */
  width?: "default" | "narrow" | "full";
}

export async function AppShellLayout({
  children,
  width = "default",
}: AppShellLayoutProps) {
  const session = await getCurrentSession(await headers());

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <WizdekShell user={{ email: session.user.email, name: session.user.name }}>
      <Page width={width}>{children}</Page>
    </WizdekShell>
  );
}
