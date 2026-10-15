"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  Copy,
  cn,
  EmptyState,
  ErrorAlert,
  Lock,
  Mail,
  ReadOnlyBanner,
  Send,
  SkeletonRows,
  StatusBadge,
  toast,
} from "@repo/design-system";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/design-system/components/ui/input-group";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useActiveOrganization } from "../../lib/active-organization";
import { formatRelative, plural } from "../../lib/format";
import { usePermissions } from "../../lib/permissions";
import {
  formatJoined,
  ListFrame,
  ListTitle,
  type Member,
  PersonAvatar,
  useMembers,
} from "../people";

type InvitationsPage = Awaited<
  ReturnType<typeof apiClient.organizations.invitations.list>
>;
type Invitation = InvitationsPage["data"][number];

const PAGE_SIZE = 20;
const DAY = 24 * 60 * 60 * 1000;
const MEMBER_COLUMNS = "minmax(240px,1fr) 110px 140px";
const INVITATION_COLUMNS = "minmax(240px,1fr) 120px 170px 90px";

const invitationsKey = (organizationId: string | null) => [
  "invitations",
  organizationId,
];

const shortDate = (value: Date | string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });

/** "Expires in 5 days" while pending, "Expired Sep 8" once lapsed. */
const expiryText = (invitation: Invitation, now = Date.now()) => {
  if (invitation.status === "EXPIRED") {
    return `Expired ${shortDate(invitation.expiresAt)}`;
  }
  if (invitation.status !== "PENDING") {
    return "—";
  }
  const days = Math.ceil(
    (new Date(invitation.expiresAt).getTime() - now) / DAY
  );
  return days <= 0 ? "Expires today" : `Expires in ${plural(days, "day")}`;
};

const InviteCard = ({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) => {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: (address: string) =>
      apiClient.organizations.invitations.create({
        email: address,
        organizationId,
      }),
    onError: (cause) =>
      toast.error("Could not send the invitation", {
        description: getApiErrorMessage(cause, "Try again."),
      }),
    onSuccess: ({ data }) => {
      setAcceptUrl(data.acceptUrl);
      setEmail("");
      if (data.delivery === "failed") {
        toast.warning("Invitation created, but the email failed", {
          description: "Share the invite link instead.",
        });
      } else {
        toast.success("Invitation sent", {
          description: `${data.email} · expires in 7 days`,
        });
      }
      queryClient.invalidateQueries({
        queryKey: invitationsKey(organizationId),
      });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAcceptUrl(null);
    invite.mutate(email.trim());
  };

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-sunken px-[18px] py-4">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="font-semibold text-sm leading-[1.3]">
          Invite people to {organizationName}
        </h2>
        <p className="text-[12.5px] text-muted-foreground leading-[1.4]">
          Invitations grant the Member role and expire after 7 days. Change
          roles under Access.
        </p>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={submit}>
        <InputGroup className="h-9 min-w-[240px] flex-1 bg-card">
          <InputGroupAddon>
            <Mail className="size-[15px] text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Email address"
            autoComplete="off"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            required
            type="email"
            value={email}
          />
        </InputGroup>
        <Button className="h-9" disabled={invite.isPending} type="submit">
          <Send />
          {invite.isPending ? "Sending…" : "Send invite"}
        </Button>
      </form>
      {acceptUrl ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <span>Invite link, if the email doesn't arrive:</span>
          <a
            className="min-w-0 break-all font-mono text-foreground-2 hover:underline"
            href={acceptUrl}
          >
            {acceptUrl}
          </a>
          <Button
            aria-label="Copy invite link"
            onClick={() => {
              navigator.clipboard
                .writeText(acceptUrl)
                .then(() => toast.success("Invite link copied"))
                .catch(() => toast.error("Could not copy the link"));
            }}
            size="icon-xs"
            variant="ghost"
          >
            <Copy />
          </Button>
        </div>
      ) : null}
    </section>
  );
};

const MemberRow = ({ member, you }: { member: Member; you: boolean }) => (
  <div
    className="grid items-center gap-4 border-border border-b px-4 py-3 last:border-b-0"
    style={{ gridTemplateColumns: MEMBER_COLUMNS }}
  >
    <div className="flex min-w-0 items-center gap-[11px]">
      <PersonAvatar id={member.user.id} name={member.user.name} />
      <div className="min-w-0">
        <div className="truncate font-semibold text-[13.5px] leading-[1.3]">
          {member.user.name}
          {you ? (
            <span className="font-normal text-muted-foreground"> · you</span>
          ) : null}
        </div>
        <div className="truncate text-muted-foreground text-xs leading-[1.3]">
          {member.user.email}
        </div>
      </div>
    </div>
    <span className="justify-self-start rounded-full border border-input px-2 py-[5px] font-medium text-foreground-2 text-xs leading-none">
      {member.role?.name ?? "No role"}
    </span>
    <span className="text-[12.5px] text-muted-foreground leading-[1.3]">
      Joined {formatJoined(member.createdAt)}
    </span>
  </div>
);

const MembersList = ({
  currentUserId,
  organizationId,
}: {
  currentUserId: string;
  organizationId: string;
}) => {
  const members = useMembers(organizationId, true);
  return (
    <section className="flex flex-col gap-2.5">
      <ListTitle count={members.data?.length} title="Members" />
      {members.isError ? (
        <ErrorAlert
          message="Members keep their access."
          onRetry={() => members.refetch()}
          title="Couldn't load members."
        />
      ) : (
        <ListFrame minWidth={560}>
          {members.isPending ? (
            <SkeletonRows columns={MEMBER_COLUMNS} count={3} />
          ) : (
            members.data.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                you={member.user.id === currentUserId}
              />
            ))
          )}
        </ListFrame>
      )}
    </section>
  );
};

const InvitationRow = ({
  canRevoke,
  invitation,
  onRevoke,
  revoking,
}: {
  canRevoke: boolean;
  invitation: Invitation;
  onRevoke: () => void;
  revoking: boolean;
}) => {
  const pending = invitation.status === "PENDING";
  return (
    <div
      className={cn(
        "grid items-center gap-4 border-border border-b px-4 py-3",
        !pending && "opacity-70"
      )}
      style={{ gridTemplateColumns: INVITATION_COLUMNS }}
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-[13.5px] leading-[1.3]">
          {invitation.email}
        </div>
        <div className="truncate text-muted-foreground text-xs leading-[1.3]">
          Invited by {invitation.invitedBy?.name ?? "a former member"} ·{" "}
          {formatRelative(invitation.createdAt)}
        </div>
      </div>
      <StatusBadge className="justify-self-start" status={invitation.status} />
      <span className="text-[12.5px] text-muted-foreground leading-[1.3]">
        {expiryText(invitation)}
      </span>
      <div className="flex justify-end">
        {canRevoke && pending ? (
          <Button
            className="text-(--status-danger-fg) hover:bg-(--alert-danger-bg) hover:text-(--status-danger-fg)"
            disabled={revoking}
            onClick={onRevoke}
            size="sm"
            variant="ghost"
          >
            Revoke
          </Button>
        ) : null}
      </div>
    </div>
  );
};

const InvitationsList = ({
  canRevoke,
  organizationId,
}: {
  canRevoke: boolean;
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const invitations = useInfiniteQuery({
    getNextPageParam: (lastPage: InvitationsPage) =>
      lastPage.pageInfo.nextCursor ?? undefined,
    // An empty cursor means the first page.
    initialPageParam: "",
    queryFn: ({ pageParam }): Promise<InvitationsPage> =>
      apiClient.organizations.invitations.list({
        limit: PAGE_SIZE,
        organizationId,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    queryKey: invitationsKey(organizationId),
  });
  const revoke = useMutation({
    mutationFn: (invitation: Invitation) =>
      apiClient.organizations.invitations.revoke({
        invitationId: invitation.id,
        organizationId,
      }),
    onError: (cause) =>
      toast.error("Could not revoke the invitation", {
        description: getApiErrorMessage(cause, "Try again."),
      }),
    onSuccess: (_, invitation) => {
      toast.warning("Invitation revoked", { description: invitation.email });
      queryClient.invalidateQueries({
        queryKey: invitationsKey(organizationId),
      });
    },
  });
  const list = invitations.data?.pages.flatMap((page) => page.data) ?? [];
  const pendingCount = list.filter((item) => item.status === "PENDING").length;

  return (
    <section className="flex flex-col gap-2.5">
      <ListTitle
        count={invitations.isPending ? undefined : `${pendingCount} pending`}
        title="Invitations"
      />
      {invitations.isError ? (
        <ErrorAlert
          message="Sent invitations still work."
          onRetry={() => invitations.refetch()}
          title="Couldn't load invitations."
        />
      ) : (
        <ListFrame minWidth={680}>
          {invitations.isPending ? (
            <SkeletonRows columns={INVITATION_COLUMNS} count={3} />
          ) : null}
          {invitations.isSuccess && list.length === 0 ? (
            <p className="px-4 py-5 text-center text-[13px] text-muted-foreground">
              No invitations yet. People you invite show up here until they
              accept.
            </p>
          ) : null}
          {list.map((invitation) => (
            <InvitationRow
              canRevoke={canRevoke}
              invitation={invitation}
              key={invitation.id}
              onRevoke={() => revoke.mutate(invitation)}
              revoking={
                revoke.isPending && revoke.variables?.id === invitation.id
              }
            />
          ))}
          {invitations.hasNextPage ? (
            <Button
              className="h-10 w-full rounded-none font-medium text-[12.5px] text-muted-foreground"
              disabled={invitations.isFetchingNextPage}
              onClick={() => invitations.fetchNextPage()}
              variant="ghost"
            >
              {invitations.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </ListFrame>
      )}
    </section>
  );
};

export function MembersPanel({ currentUserId }: { currentUserId: string }) {
  const { organization } = useActiveOrganization();
  const { can, isLoading } = usePermissions();
  if (!organization || isLoading) {
    return (
      <ListFrame minWidth={560}>
        <SkeletonRows columns={MEMBER_COLUMNS} count={3} />
      </ListFrame>
    );
  }
  if (!can("members:read")) {
    return (
      <EmptyState
        description="Seeing members needs the members:read permission. Ask an Owner for access."
        icon={<Lock />}
        title="You don't have permission to see members"
      />
    );
  }
  const canInvite = can("members:invite");
  return (
    <div className="flex flex-col gap-[22px]">
      {canInvite ? (
        <InviteCard
          organizationId={organization.id}
          organizationName={organization.name}
        />
      ) : (
        <ReadOnlyBanner>
          You can see members but not invite them. Inviting needs{" "}
          <strong>members:invite</strong>.
        </ReadOnlyBanner>
      )}
      <MembersList
        currentUserId={currentUserId}
        organizationId={organization.id}
      />
      <InvitationsList canRevoke={canInvite} organizationId={organization.id} />
    </div>
  );
}
