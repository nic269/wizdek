import { safeAuthCallbackUrl } from "@repo/auth/callback-url";
import { AuthForm } from "../auth-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <AuthForm callbackUrl={safeAuthCallbackUrl(callbackUrl)} mode="sign-in" />
    </main>
  );
}
