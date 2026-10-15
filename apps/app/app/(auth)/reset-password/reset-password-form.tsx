"use client";

import { authClient } from "@repo/auth/client";
import {
  buttonVariants,
  ClockAlert,
  InlineAlert,
  Input,
  toast,
} from "@repo/design-system";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { AUTH_INPUT_CLASS, AuthLink, AuthSubmit } from "../auth-form";
import { AuthHeading, AuthIcon } from "../auth-split";
import { BackToSignIn } from "../back-to-sign-in";
import { MIN_PASSWORD_LENGTH } from "../password-strength";

const getErrorMessage = (error: unknown) => {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Password reset failed. Request a new reset link and try again.";
};

const MissingToken = () => (
  <>
    <AuthIcon tone="warning">
      <ClockAlert />
    </AuthIcon>
    <AuthHeading title="This reset link isn’t valid">
      The link is missing its token. Request a new one to choose a password.
    </AuthHeading>
    <Link
      className={buttonVariants({ className: "h-[38px] w-full text-sm" })}
      href="/forgot-password"
    >
      Request a new link
    </Link>
    <BackToSignIn />
  </>
);

export const ResetPasswordForm = ({ token }: { token: string }) => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  if (!token) {
    return <MissingToken />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);
    const newPassword = String(formData.get("password") ?? "");

    try {
      const response = await authClient.resetPassword({
        newPassword,
        token,
      });

      if (response.error) {
        setError(getErrorMessage(response.error));
        return;
      }

      toast.success("Password updated", {
        description: "Sign in with your new password.",
      });
      router.push("/sign-in");
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <AuthHeading title="Choose a new password">
        Use at least {MIN_PASSWORD_LENGTH} characters.
      </AuthHeading>
      <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
        <Field className="gap-1.5">
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input
            autoComplete="new-password"
            className={AUTH_INPUT_CLASS}
            id="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            name="password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            required
            type="password"
          />
        </Field>
        {error ? (
          <InlineAlert tone="danger">
            {error}{" "}
            <AuthLink href="/forgot-password">Request a new link</AuthLink>
          </InlineAlert>
        ) : null}
        <AuthSubmit pending={isPending}>Update password</AuthSubmit>
      </form>
      <BackToSignIn />
    </>
  );
};
