"use client";

import {
  apiClient,
  getApiErrorCode,
  getApiErrorMessage,
} from "@repo/api/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function InviteAcceptance({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const callbackUrl = `/invite/${token}`;

  const accept = async () => {
    setError(null);
    setNeedsAuth(false);
    setIsPending(true);
    try {
      await apiClient.invitations.accept({ token });
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      if (getApiErrorCode(cause) === "UNAUTHORIZED") {
        setNeedsAuth(true);
        return;
      }
      setError(getApiErrorMessage(cause, "Could not accept invitation."));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Organization invitation</CardTitle>
        <CardDescription>
          Sign in with the invited email address, then accept access.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          className="w-full"
          disabled={isPending}
          onClick={() => {
            accept();
          }}
        >
          {isPending ? "Accepting..." : "Accept invitation"}
        </Button>
        {needsAuth ? (
          <div className="flex gap-3 text-sm">
            <Link
              className="font-medium text-primary hover:underline"
              href={`/sign-in?callbackUrl=${callbackUrl}`}
            >
              Sign in
            </Link>
            <Link
              className="font-medium text-primary hover:underline"
              href={`/sign-up?callbackUrl=${callbackUrl}`}
            >
              Create account
            </Link>
          </div>
        ) : null}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
