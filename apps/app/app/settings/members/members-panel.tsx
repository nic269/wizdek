"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@repo/design-system";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type Organization = Awaited<
  ReturnType<typeof apiClient.organizations.list>
>["data"][number];
type Invitation = Awaited<
  ReturnType<typeof apiClient.organizations.invitations.list>
>["data"][number];

export function MembersPanel() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationCursor, setInvitationCursor] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const loadInvitations = useCallback(
    async (selectedOrganizationId: string) => {
      if (!selectedOrganizationId) {
        return;
      }
      const response = await apiClient.organizations.invitations.list({
        limit: 20,
        organizationId: selectedOrganizationId,
      });
      setInvitations(response.data);
      setInvitationCursor(response.pageInfo.nextCursor);
    },
    []
  );

  const loadMoreInvitations = async () => {
    if (!(organizationId && invitationCursor)) {
      return;
    }
    const response = await apiClient.organizations.invitations.list({
      cursor: invitationCursor,
      limit: 20,
      organizationId,
    });
    setInvitations((current) => [...current, ...response.data]);
    setInvitationCursor(response.pageInfo.nextCursor);
  };

  useEffect(() => {
    apiClient.organizations
      .list({})
      .then((response) => response.data)
      .then((data) => {
        setOrganizations(data);
        const first = data[0]?.id ?? "";
        setOrganizationId(first);
        return loadInvitations(first);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Could not load members."
        )
      );
  }, [loadInvitations]);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setAcceptUrl(null);
    setIsBusy(true);
    try {
      const created = await apiClient.organizations.invitations.create({
        email,
        organizationId,
      });
      setAcceptUrl(created.data.acceptUrl);
      setEmail("");
      await loadInvitations(organizationId);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not send invitation."));
    } finally {
      setIsBusy(false);
    }
  };

  const revoke = async (invitationId: string) => {
    setError(null);
    try {
      await apiClient.organizations.invitations.revoke({
        invitationId,
        organizationId,
      });
      await loadInvitations(organizationId);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not revoke invitation."));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invite member</CardTitle>
          <CardDescription>
            Invitations expire after seven days and grant the Member role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <select
            aria-label="Organization"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            onChange={(event) => {
              setOrganizationId(event.target.value);
              loadInvitations(event.target.value);
            }}
            value={organizationId}
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={invite}>
            <Input
              onChange={(event) => setEmail(event.target.value)}
              placeholder="member@example.com"
              required
              type="email"
              value={email}
            />
            <Button disabled={isBusy || !organizationId} type="submit">
              {isBusy ? "Sending..." : "Send invite"}
            </Button>
          </form>
          {acceptUrl ? (
            <a
              className="block break-all font-medium text-primary text-sm hover:underline"
              href={acceptUrl}
            >
              {acceptUrl}
            </a>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>
            Pending and historical invitations for this organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-md border">
            {invitations.map((invitation) => (
              <li
                className="flex items-center justify-between gap-3 px-3 py-3"
                key={invitation.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">
                    {invitation.email}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {invitation.status.toLowerCase()}
                  </p>
                </div>
                {invitation.status === "PENDING" ? (
                  <Button
                    onClick={() => {
                      revoke(invitation.id);
                    }}
                    size="sm"
                    variant="destructive"
                  >
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {invitationCursor ? (
            <Button
              className="mt-3"
              onClick={loadMoreInvitations}
              variant="outline"
            >
              Load more
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
