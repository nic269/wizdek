"use client";

import { authClient } from "@repo/auth/client";
import {
  Button,
  InlineAlert,
  Input,
  MailCheck,
  toast,
} from "@repo/design-system";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import type { FormEvent } from "react";
import { useState } from "react";
import { AUTH_INPUT_CLASS, AuthSubmit } from "../auth-form";
import { AuthHeading, AuthIcon } from "../auth-split";
import { BackToSignIn } from "../back-to-sign-in";

const getErrorMessage = (error: unknown) => {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Password reset failed. Check the email address and try again.";
};

const requestReset = async (email: string) => {
  const response = await authClient.requestPasswordReset({
    email,
    redirectTo: "/reset-password",
  });
  if (response.error) {
    throw response.error;
  }
};

const CheckYourEmail = ({ email }: { email: string }) => {
  const [isPending, setIsPending] = useState(false);
  const resend = async () => {
    setIsPending(true);
    try {
      await requestReset(email);
      toast.success("Link sent", { description: `Check ${email}` });
    } catch (cause) {
      toast.error("Could not send the link", {
        description: getErrorMessage(cause),
      });
    } finally {
      setIsPending(false);
    }
  };
  return (
    <>
      <AuthIcon tone="accent">
        <MailCheck />
      </AuthIcon>
      <AuthHeading title="Check your email">
        If an account exists for <strong>{email}</strong>, a reset link is on
        its way. It expires in 1 hour.
      </AuthHeading>
      <Button
        className="h-[38px] text-sm"
        disabled={isPending}
        onClick={resend}
        variant="outline"
      >
        {isPending ? "Sending…" : "Resend link"}
      </Button>
    </>
  );
};

export const ForgotPasswordForm = () => {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");

    try {
      await requestReset(email);
      setSentEmail(email);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      {sentEmail ? (
        <CheckYourEmail email={sentEmail} />
      ) : (
        <>
          <AuthHeading title="Reset your password">
            Enter your email and we’ll send a link to choose a new password.
          </AuthHeading>
          <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="recovery-email">Email</FieldLabel>
              <Input
                autoComplete="email"
                className={AUTH_INPUT_CLASS}
                id="recovery-email"
                name="email"
                placeholder="you@example.com"
                required
                type="email"
              />
            </Field>
            {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
            <AuthSubmit pending={isPending}>Send reset link</AuthSubmit>
          </form>
        </>
      )}
      <BackToSignIn />
    </>
  );
};
