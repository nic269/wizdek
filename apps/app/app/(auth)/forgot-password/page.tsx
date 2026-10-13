import { authFeatureConfig } from "@repo/config";
import { notFound } from "next/navigation";
import { ForgotPasswordForm } from "./password-recovery-form";

export default function ForgotPasswordPage() {
  if (!authFeatureConfig.passwordReset) {
    notFound();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <ForgotPasswordForm />
    </main>
  );
}
