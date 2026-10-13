import { safeAuthCallbackUrl } from "@repo/auth/callback-url";
import { authFeatureConfig } from "@repo/config";
import { notFound } from "next/navigation";
import { VerifyEmailForm } from "./verify-email-form";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
    email?: string;
    token?: string;
  }>;
}) {
  if (!authFeatureConfig.requireEmailVerification) {
    notFound();
  }

  const { callbackUrl, email, token } = await searchParams;
  const safeCallbackUrl = safeAuthCallbackUrl(callbackUrl);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <VerifyEmailForm
        callbackUrl={safeCallbackUrl}
        email={email ?? ""}
        token={token ?? ""}
      />
    </main>
  );
}
