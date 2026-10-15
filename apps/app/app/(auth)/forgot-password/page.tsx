import { authFeatureConfig } from "@repo/config";
import { notFound } from "next/navigation";
import { ForgotPasswordForm } from "./password-recovery-form";

export default function ForgotPasswordPage() {
  if (!authFeatureConfig.passwordReset) {
    notFound();
  }

  return <ForgotPasswordForm />;
}
