"use client";

import { signIn, signUp } from "@repo/auth/client";
import { authFeatureConfig } from "@repo/config";
import {
  Button,
  cn,
  InlineAlert,
  Input,
  LoaderCircle,
} from "@repo/design-system";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { AuthHeading } from "./auth-split";
import { MIN_PASSWORD_LENGTH, passwordStrength } from "./password-strength";

type AuthMode = "sign-in" | "sign-up";

interface AuthFormProps {
  callbackUrl?: string;
  mode: AuthMode;
}

const WRONG_CREDENTIALS =
  "That email and password don’t match. Try again or reset your password.";

const getErrorMessage = (error: unknown) => {
  if (error && typeof error === "object") {
    if ("code" in error && error.code === "INVALID_EMAIL_OR_PASSWORD") {
      return WRONG_CREDENTIALS;
    }
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
  }
  return "Authentication failed. Check your details and try again.";
};

/** Auth form inputs are 38px with 14px text, a step up from app forms. */
export const AUTH_INPUT_CLASS = "h-[38px] px-[11px] text-sm";

export const AuthLink = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <Link
    className="font-medium text-accent-ink underline-offset-2 hover:underline"
    href={href}
  >
    {children}
  </Link>
);

/** The primary auth button, with a spinner while the request runs. */
export const AuthSubmit = ({
  children,
  pending,
}: {
  children: ReactNode;
  pending: boolean;
}) => (
  <Button className="h-[38px] w-full text-sm" disabled={pending} type="submit">
    {pending ? <LoaderCircle className="animate-spin" /> : null}
    {children}
  </Button>
);

const METER_TONES = [
  "bg-border",
  "bg-(--status-danger-dot)",
  "bg-(--status-warning-dot)",
  "bg-(--status-success-dot)",
  "bg-(--status-success-dot)",
] as const;

const StrengthMeter = ({ password }: { password: string }) => {
  const { label, score } = passwordStrength(password);
  return (
    <>
      <span aria-hidden="true" className="mt-0.5 flex gap-1">
        {[1, 2, 3, 4].map((segment) => (
          <span
            className={cn(
              "h-[3px] flex-1 rounded-full",
              segment <= score ? METER_TONES[score] : "bg-border"
            )}
            key={segment}
          />
        ))}
      </span>
      <span aria-live="polite" className="text-muted-foreground text-xs">
        {password ? `${label} · ` : ""}at least {MIN_PASSWORD_LENGTH} characters
      </span>
    </>
  );
};

const copy = {
  "sign-in": {
    description: "Welcome back. Pick up where your team left off.",
    submit: "Sign in",
    switchHref: "/sign-up",
    switchLabel: "New to wizdek?",
    switchText: "Create an account",
    title: "Sign in",
  },
  "sign-up": {
    description: "Then create an organization and connect your first store.",
    submit: "Create account",
    switchHref: "/sign-in",
    switchLabel: "Already have an account?",
    switchText: "Sign in",
    title: "Create your account",
  },
} satisfies Record<AuthMode, Record<string, string>>;

export const AuthForm = ({
  mode,
  callbackUrl = "/dashboard",
}: AuthFormProps) => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [password, setPassword] = useState("");
  const text = copy[mode];
  const signingUp = mode === "sign-up";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const name = String(formData.get("name") ?? "");

    try {
      const response = signingUp
        ? await signUp.email({
            callbackURL: callbackUrl,
            email,
            name,
            password,
          })
        : await signIn.email({ callbackURL: callbackUrl, email, password });

      if (response.error) {
        setError(getErrorMessage(response.error));
        return;
      }

      if (signingUp && authFeatureConfig.requireEmailVerification) {
        const verificationParams = new URLSearchParams({
          callbackUrl,
          email,
        });
        router.push(`/verify-email?${verificationParams.toString()}`);
      } else {
        router.push(callbackUrl);
      }
      router.refresh();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <AuthHeading title={text.title}>{text.description}</AuthHeading>
      <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
        {signingUp ? (
          <Field className="gap-1.5">
            <FieldLabel htmlFor="auth-name">Name</FieldLabel>
            <Input
              autoComplete="name"
              className={AUTH_INPUT_CLASS}
              id="auth-name"
              name="name"
              placeholder="Full name"
              required
            />
          </Field>
        ) : null}
        <Field className="gap-1.5">
          <FieldLabel htmlFor="auth-email">
            {signingUp ? "Work email" : "Email"}
          </FieldLabel>
          <Input
            autoComplete="email"
            className={AUTH_INPUT_CLASS}
            id="auth-email"
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
        </Field>
        <Field className="gap-1.5">
          <div className="flex items-center">
            <FieldLabel className="flex-1" htmlFor="auth-password">
              Password
            </FieldLabel>
            {!signingUp && authFeatureConfig.passwordReset ? (
              <span className="text-[13px] leading-none">
                <AuthLink href="/forgot-password">Forgot password?</AuthLink>
              </span>
            ) : null}
          </div>
          <Input
            autoComplete={signingUp ? "new-password" : "current-password"}
            className={AUTH_INPUT_CLASS}
            id="auth-password"
            minLength={MIN_PASSWORD_LENGTH}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
            type="password"
            value={password}
          />
          {signingUp ? <StrengthMeter password={password} /> : null}
        </Field>
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <AuthSubmit pending={isPending}>{text.submit}</AuthSubmit>
      </form>
      <p className="text-[13.5px] text-muted-foreground leading-normal">
        {text.switchLabel}{" "}
        <AuthLink
          href={`${text.switchHref}?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          {text.switchText}
        </AuthLink>
      </p>
    </>
  );
};
