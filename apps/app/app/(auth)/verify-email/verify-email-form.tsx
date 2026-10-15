"use client";

import { authClient } from "@repo/auth/client";
import {
  BadgeCheck,
  Button,
  buttonVariants,
  ClockAlert,
  InlineAlert,
  Input,
  LoaderCircle,
  MailCheck,
  toast,
} from "@repo/design-system";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
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

  return "Email verification failed. Request a new verification link.";
};

const isExpired = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "TOKEN_EXPIRED"
  );

const sendLink = async (email: string, callbackUrl: string) => {
  const response = await authClient.sendVerificationEmail({
    callbackURL: callbackUrl,
    email,
  });
  if (response.error) {
    throw response.error;
  }
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

type Outcome = "verifying" | "verified" | "expired" | "invalid";

const TokenVerificationPanel = ({
  callbackUrl,
  token,
}: {
  callbackUrl: string;
  token: string;
}) => {
  const [outcome, setOutcome] = useState<Outcome>("verifying");

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      // Without a callback URL the server answers with JSON instead of a
      // redirect, so a bad or expired token comes back as an error.
      const response = await authClient.verifyEmail({ query: { token } });
      if (cancelled) {
        return;
      }
      if (response.error) {
        setOutcome(isExpired(response.error) ? "expired" : "invalid");
        return;
      }
      setOutcome("verified");
    };

    verify().catch(() => {
      if (!cancelled) {
        setOutcome("invalid");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (outcome === "verifying") {
    return (
      <div
        className="flex items-center gap-2.5 text-muted-foreground text-sm"
        role="status"
      >
        <LoaderCircle className="size-4 animate-spin" />
        Verifying your email…
      </div>
    );
  }

  if (outcome === "verified") {
    return (
      <>
        <AuthIcon tone="success">
          <BadgeCheck />
        </AuthIcon>
        <AuthHeading title="Email verified">
          You’re all set. Next, create an organization or accept an invitation.
        </AuthHeading>
        <Link
          className={buttonVariants({ className: "h-[38px] w-full text-sm" })}
          href={callbackUrl}
        >
          Continue to wizdek
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthIcon tone="warning">
        <ClockAlert />
      </AuthIcon>
      <AuthHeading
        title={
          outcome === "expired"
            ? "This link has expired"
            : "This link isn’t valid"
        }
      >
        Verification links last 1 hour and work once. Send a fresh one to your
        email.
      </AuthHeading>
      <SendLinkForm
        callbackUrl={callbackUrl}
        email=""
        label="Send a new link"
      />
      <BackToSignIn />
    </>
  );
};

/** Asks for an email and sends a verification link to it. */
const SendLinkForm = ({
  callbackUrl,
  email,
  label,
}: {
  callbackUrl: string;
  email: string;
  label: string;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);
    const targetEmail = String(
      new FormData(event.currentTarget).get("email") ?? ""
    );
    try {
      await sendLink(targetEmail, callbackUrl);
      toast.success("Link sent", { description: `Check ${targetEmail}` });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
      <Field className="gap-1.5">
        <FieldLabel htmlFor="verify-email">Email</FieldLabel>
        <Input
          autoComplete="email"
          className={AUTH_INPUT_CLASS}
          defaultValue={email}
          id="verify-email"
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </Field>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <AuthSubmit pending={isPending}>{label}</AuthSubmit>
    </form>
  );
};

/** After sign-up: the link is on its way, with a way to send another. */
const ResendVerificationPanel = ({
  callbackUrl,
  email,
}: {
  callbackUrl: string;
  email: string;
}) => {
  const [isPending, setIsPending] = useState(false);

  if (!email) {
    return (
      <>
        <AuthHeading title="Verify your email">
          Enter your email and we’ll send a link to confirm it.
        </AuthHeading>
        <SendLinkForm
          callbackUrl={callbackUrl}
          email=""
          label="Send verification link"
        />
        <BackToSignIn />
      </>
    );
  }

  const resend = async () => {
    setIsPending(true);
    try {
      await sendLink(email, callbackUrl);
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
        We sent a verification link to <strong>{email}</strong>. Open it to
        finish creating your account. It expires in 1 hour.
      </AuthHeading>
      <Button
        className="h-[38px] text-sm"
        disabled={isPending}
        onClick={resend}
        variant="outline"
      >
        {isPending ? "Sending…" : "Resend link"}
      </Button>
      <BackToSignIn />
    </>
  );
};
