import { authFeatureConfig } from "@repo/config";
import { notFound } from "next/navigation";
import { InviteAcceptance } from "./invite-acceptance";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!authFeatureConfig.organizationInvitations) {
    notFound();
  }

  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <InviteAcceptance token={token} />
    </main>
  );
}
