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
import { useEffect, useState } from "react";

const getErrorMessage = (error: unknown) => {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Email verification failed. Request a new verification link.";
};

export const VerifyEmailForm = ({
  callbackUrl,
  email,
  token,
}: {
  callbackUrl: string;
  email: string;
  token: string;
}) => {
  if (token) {
    return <TokenVerificationPanel callbackUrl={callbackUrl} token={token} />;
  }

  return <ResendVerificationPanel callbackUrl={callbackUrl} email={email} />;
};

const TokenVerificationPanel = ({
  callbackUrl,
  token,
}: {
  callbackUrl: string;
  token: string;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(Boolean(token));
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      try {
        const response = await authClient.verifyEmail({
          query: {
            callbackURL: callbackUrl,
            token,
          },
        });

        if (cancelled) {
          return;
        }

        if (response.error) {
          setError(getErrorMessage(response.error));
          return;
        }

        setVerified(true);
      } catch (caughtError) {
        if (!cancelled) {
          setError(getErrorMessage(caughtError));
        }
      } finally {
        if (!cancelled) {
          setIsPending(false);
        }
      }
    };

    verify().catch((caughtError) => {
      if (!cancelled) {
        setError(getErrorMessage(caughtError));
        setIsPending(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [callbackUrl, token]);

  return (
    <VerificationCard>
      <div className="space-y-4">
        {isPending ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground text-sm">
            Verifying your email...
          </p>
        ) : null}
        {verified ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground text-sm">
            Your email has been verified.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
            {error}
          </p>
        ) : null}
        {isPending ? null : (
          <Link
            className={buttonVariants({ className: "w-full" })}
            href={verified ? callbackUrl : "/verify-email"}
          >
            {verified ? "Continue" : "Request a new link"}
          </Link>
        )}
      </div>
    </VerificationCard>
  );
};

const ResendVerificationPanel = ({
  callbackUrl,
  email,
}: {
  callbackUrl: string;
  email: string;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);
    const targetEmail = String(formData.get("email") ?? "");

    try {
      const response = await authClient.sendVerificationEmail({
        callbackURL: callbackUrl,
        email: targetEmail,
      });

      if (response.error) {
        setError(getErrorMessage(response.error));
        return;
      }

      setSentEmail(targetEmail);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <VerificationCard>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          autoComplete="email"
          defaultValue={email}
          disabled={Boolean(sentEmail)}
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
        {sentEmail ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground text-sm">
            A verification link has been sent to {sentEmail}.
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
          {isPending ? "Sending..." : "Send verification link"}
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
    </VerificationCard>
  );
};

const VerificationCard = ({ children }: { children: React.ReactNode }) => (
  <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle>Verify email</CardTitle>
      <CardDescription>
        Confirm email ownership before using account features.
      </CardDescription>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);
