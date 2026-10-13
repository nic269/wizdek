"use client";

import { authClient } from "@repo/auth/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@repo/design-system";
import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";

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
      const response = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });

      if (response.error) {
        setError(getErrorMessage(response.error));
        return;
      }

      setSentEmail(email);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Reset password</CardTitle>
        <CardDescription>
          Enter your account email to receive a reset link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            autoComplete="email"
            disabled={Boolean(sentEmail)}
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
          {sentEmail ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground text-sm">
              If an account exists for {sentEmail}, a reset link has been sent.
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <Button
            className="w-full"
            disabled={isPending || Boolean(sentEmail)}
            type="submit"
          >
            {isPending ? "Sending..." : "Send reset link"}
          </Button>
          <p className="text-center text-muted-foreground text-sm">
            <Link
              className="font-medium text-primary hover:underline"
              href="/sign-in"
            >
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
};
