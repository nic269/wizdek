"use client";

import { authClient } from "@repo/auth/client";
import {
  Button,
  buttonVariants,
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

  return "Password reset failed. Request a new reset link and try again.";
};

export const ResetPasswordForm = ({ token }: { token: string }) => {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

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

      setIsComplete(true);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>Set a new password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        {token ? (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input
              autoComplete="new-password"
              disabled={isComplete}
              minLength={8}
              name="password"
              placeholder="New password"
              required
              type="password"
            />
            {isComplete ? (
              <p className="rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground text-sm">
                Your password has been updated.
              </p>
            ) : null}
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={isPending || isComplete}
              type="submit"
            >
              {isPending ? "Updating..." : "Update password"}
            </Button>
            <p className="text-center text-muted-foreground text-sm">
              <Link
                className="font-medium text-primary hover:underline"
                href="/sign-in"
              >
                Sign in
              </Link>
            </p>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
              This reset link is missing a token.
            </p>
            <Link
              className={buttonVariants({ className: "w-full" })}
              href="/forgot-password"
            >
              Request a new reset link
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
