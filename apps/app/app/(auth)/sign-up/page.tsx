import { safeAuthCallbackUrl } from "@repo/auth/callback-url";
import { AuthForm } from "../auth-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <AuthForm callbackUrl={safeAuthCallbackUrl(callbackUrl)} mode="sign-up" />
  );
}
