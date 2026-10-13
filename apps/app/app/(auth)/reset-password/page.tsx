import { authFeatureConfig } from "@repo/config";
import { notFound } from "next/navigation";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (!authFeatureConfig.passwordReset) {
    notFound();
  }

  const { token } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <ResetPasswordForm token={token ?? ""} />
    </main>
  );
}
