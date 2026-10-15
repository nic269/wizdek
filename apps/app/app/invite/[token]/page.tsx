import { getCurrentSession } from "@repo/auth/session";
import { authFeatureConfig } from "@repo/config";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AuthSplit } from "../../(auth)/auth-split";
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
  const session = await getCurrentSession(await headers());
  return (
    <AuthSplit>
      <InviteAcceptance
        token={token}
        viewerEmail={session?.user.email ?? null}
      />
    </AuthSplit>
  );
}
