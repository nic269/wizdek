"use client";

import {
  apiClient,
  getApiErrorCode,
  getApiErrorMessage,
} from "@repo/api/client";
import { signOut } from "@repo/auth/client";
import {
  Button,
  buttonVariants,
  ClockAlert,
  ErrorAlert,
  IdentityChip,
  InlineAlert,
  LoaderCircle,
  Mail,
  toast,
} from "@repo/design-system";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { AuthSubmit } from "../../(auth)/auth-form";
import { AuthHeading, AuthIcon } from "../../(auth)/auth-split";
import { rememberOrganization } from "../../lib/active-organization";
import { plural } from "../../lib/format";

type Preview = Awaited<
  ReturnType<typeof apiClient.invitations.preview>
>["data"];

/** What each built-in role lets a new member do, for the invitation line. */
const ROLE_SUMMARIES: Record<string, string> = {
  Admin: "manage stores, flows, databases and members",
  Member: "query stores and run flows",
  Owner: "use every part of the organization",
  Viewer: "see stores, flows and runs without changing them",
};

const longDate = (value: Date | string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const FULL_BUTTON = "h-[38px] flex-1 text-sm";

const Ended = ({ children, title }: { children: ReactNode; title: string }) => (
  <>
    <AuthIcon tone="warning">
      <ClockAlert />
    </AuthIcon>
    <AuthHeading title={title}>{children}</AuthHeading>
    <Link
      className={buttonVariants({
        className: FULL_BUTTON,
        variant: "outline",
      })}
      href="/dashboard"
    >
      Go to wizdek
    </Link>
  </>
);

/** An invitation that can no longer be accepted, and why. */
const EndedInvitation = ({ preview }: { preview: Preview }) => {
  const inviter = preview.invitedBy?.name ?? "the person who invited you";
  if (preview.status === "ACCEPTED") {
    return (
      <Ended title="This invitation was already accepted">
        Open wizdek to work in <strong>{preview.organization.name}</strong>.
      </Ended>
    );
  }
  if (preview.status === "REVOKED") {
    return (
      <Ended title="This invitation was revoked">
        Ask {inviter} for a new one if you still need access to{" "}
        <strong>{preview.organization.name}</strong>.
      </Ended>
    );
  }
  return (
    <Ended title="This invitation has expired">
      It expired on {longDate(preview.expiresAt)}. Ask {inviter} to send a new
      one.
    </Ended>
  );
};

const SignedInAs = ({
  callbackUrl,
  email,
}: {
  callbackUrl: string;
  email: string;
}) => {
  const [isPending, setIsPending] = useState(false);
  const switchAccount = async () => {
    setIsPending(true);
    try {
      await signOut();
      window.location.assign(
        `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`
      );
    } catch {
      setIsPending(false);
      toast.error("Could not sign out", { description: "Try again." });
    }
  };
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-sunken px-3 py-2.5 text-[13px] leading-[1.4]">
      <Mail className="size-[15px] shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        Signed in as <strong className="font-semibold">{email}</strong>
      </span>
      <Button
        className="h-auto p-0 font-medium text-accent-ink"
        disabled={isPending}
        onClick={switchAccount}
        variant="link"
      >
        Switch
      </Button>
    </div>
  );
};

const SignedOut = ({
  callbackUrl,
  email,
}: {
  callbackUrl: string;
  email: string;
}) => {
  const query = `?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  return (
    <>
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-sunken px-3 py-2.5 text-[13px] leading-[1.4]">
        <Mail className="size-[15px] shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          Sign in or create an account with{" "}
          <strong className="font-semibold">{email}</strong> to accept.
        </span>
      </div>
      <div className="flex gap-2">
        <Link
          className={buttonVariants({ className: FULL_BUTTON })}
          href={`/sign-up${query}`}
        >
          Create account
        </Link>
        <Link
          className={buttonVariants({
            className: FULL_BUTTON,
            variant: "outline",
          })}
          href={`/sign-in${query}`}
        >
          Sign in
        </Link>
      </div>
    </>
  );
};

const PendingInvitation = ({
  preview,
  token,
  viewerEmail,
}: {
  preview: Preview;
  token: string;
  viewerEmail: string | null;
}) => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const callbackUrl = `/invite/${token}`;
  const roleName = preview.role?.name ?? "Member";
  const summary =
    ROLE_SUMMARIES[roleName] ?? "use the permissions of this role";
  const mismatch =
    viewerEmail !== null &&
    viewerEmail.toLowerCase() !== preview.email.toLowerCase();

  const accept = async () => {
    setError(null);
    setIsPending(true);
    try {
      const { data } = await apiClient.invitations.accept({ token });
      rememberOrganization(data.organization.id);
      toast.success(`Welcome to ${data.organization.name}`, {
        description: `You joined as a ${roleName}.`,
      });
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      if (getApiErrorCode(cause) === "UNAUTHORIZED") {
        router.push(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        return;
      }
      setError(getApiErrorMessage(cause, "Could not accept the invitation."));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <IdentityChip
          className="rounded-[11px]!"
          id={preview.organization.id}
          name={preview.organization.name}
          size={44}
          variant="organization"
        />
        <div className="text-[13px] text-muted-foreground leading-[1.4]">
          Invitation from
          <br />
          <strong className="font-semibold text-foreground">
            {preview.invitedBy?.name ?? preview.organization.name}
          </strong>
        </div>
      </div>
      <AuthHeading title={`Join ${preview.organization.name} on wizdek`}>
        You’ll join as a <strong>{roleName}</strong>: {summary}
        {preview.connectedStoreCount > 0
          ? ` across ${plural(preview.connectedStoreCount, "connected Shopify store")}`
          : ""}
        .
      </AuthHeading>
      {viewerEmail ? (
        <SignedInAs callbackUrl={callbackUrl} email={viewerEmail} />
      ) : (
        <SignedOut callbackUrl={callbackUrl} email={preview.email} />
      )}
      {mismatch ? (
        <InlineAlert tone="warning">
          This invitation is for <strong>{preview.email}</strong>. Switch to
          that account to accept it.
        </InlineAlert>
      ) : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {viewerEmail && !mismatch ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            accept();
          }}
        >
          <AuthSubmit pending={isPending}>Accept invitation</AuthSubmit>
        </form>
      ) : null}
      <p className="text-[12.5px] text-muted-foreground leading-[1.4]">
        Expires {longDate(preview.expiresAt)}.
      </p>
    </>
  );
};

export function InviteAcceptance({
  token,
  viewerEmail,
}: {
  token: string;
  viewerEmail: string | null;
}) {
  const preview = useQuery({
    queryFn: async () => (await apiClient.invitations.preview({ token })).data,
    queryKey: ["invitation-preview", token],
    retry: false,
  });

  if (preview.isPending) {
    return (
      <div
        className="flex items-center gap-2.5 text-muted-foreground text-sm"
        role="status"
      >
        <LoaderCircle className="size-4 animate-spin" />
        Loading the invitation…
      </div>
    );
  }
  if (preview.isError) {
    if (getApiErrorCode(preview.error) === "INVITATION_NOT_FOUND") {
      return (
        <Ended title="This invitation link isn’t valid">
          Check that you opened the whole link, or ask for a new invitation.
        </Ended>
      );
    }
    return (
      <ErrorAlert
        message={getApiErrorMessage(preview.error, "Try again.")}
        onRetry={() => preview.refetch()}
        title="Couldn't load the invitation."
      />
    );
  }
  if (preview.data.status !== "PENDING") {
    return <EndedInvitation preview={preview.data} />;
  }
  return (
    <PendingInvitation
      preview={preview.data}
      token={token}
      viewerEmail={viewerEmail}
    />
  );
}
