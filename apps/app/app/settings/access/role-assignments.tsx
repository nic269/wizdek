"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { ErrorAlert, Lock, SkeletonRows, toast } from "@repo/design-system";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OptionSelect } from "../../lib/option-select";
import {
  ListFrame,
  ListTitle,
  type Member,
  PersonAvatar,
  peopleKeys,
  type Role,
  useMembers,
} from "../people";
import { sortRoles } from "./access-model";

const LockedRole = ({ name, title }: { name: string; title: string }) => (
  <span
    className="flex h-8 w-[150px] items-center justify-between gap-2 rounded-md border border-input bg-sunken px-2.5 font-medium text-[13px]"
    title={title}
  >
    <span className="truncate">{name}</span>
    <Lock aria-hidden="true" className="size-[13px] text-muted-foreground" />
  </span>
);

const AssignmentRow = ({
  canManage,
  member,
  onChange,
  roles,
  you,
}: {
  canManage: boolean;
  member: Member;
  onChange: (roleId: string) => void;
  roles: Role[];
  you: boolean;
}) => {
  const roleName = member.role?.name ?? "No role";
  const lockReason = you
    ? "You can't change your own role."
    : "Changing roles needs members:manage.";
  return (
    <div className="flex items-center gap-3 border-border border-b px-4 py-[11px] last:border-b-0">
      <PersonAvatar id={member.user.id} name={member.user.name} size={30} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-[13.5px] leading-[1.3]">
          {member.user.name}
        </div>
        <div className="truncate text-muted-foreground text-xs leading-[1.3]">
          {member.user.email}
        </div>
      </div>
      {canManage && !you ? (
        <OptionSelect
          aria-label={`Role for ${member.user.email}`}
          className="h-8! w-[150px] font-medium text-[13px]"
          onValueChange={onChange}
          options={roles.map((role) => ({ label: role.name, value: role.id }))}
          placeholder="No role"
          value={member.role?.id ?? null}
        />
      ) : (
        <LockedRole name={roleName} title={lockReason} />
      )}
    </div>
  );
};

/** Each member with their role; owners and admins change it inline. */
export function RoleAssignments({
  canManage,
  currentUserId,
  organizationId,
  roles,
}: {
  canManage: boolean;
  currentUserId: string;
  organizationId: string;
  roles: Role[];
}) {
  const queryClient = useQueryClient();
  const members = useMembers(organizationId, true);
  const update = useMutation({
    mutationFn: (input: { member: Member; roleId: string }) =>
      apiClient.organizations.members.updateRole({
        membershipId: input.member.id,
        organizationId,
        roleId: input.roleId,
      }),
    onError: (cause) =>
      toast.error("Could not change the role", {
        description: getApiErrorMessage(cause, "Try again."),
      }),
    onSuccess: (_, { member, roleId }) => {
      const role = roles.find((item) => item.id === roleId);
      toast.success("Role updated", {
        description: `${member.user.name} is now ${role?.name ?? "updated"}.`,
      });
      queryClient.invalidateQueries({
        queryKey: peopleKeys.members(organizationId),
      });
      queryClient.invalidateQueries({
        queryKey: peopleKeys.roles(organizationId),
      });
    },
  });
  const ordered = sortRoles(roles);

  return (
    <section className="flex flex-col gap-2.5">
      <ListTitle title="Role assignments" />
      {members.isError ? (
        <ErrorAlert
          message="Everyone keeps their current role."
          onRetry={() => members.refetch()}
          title="Couldn't load members."
        />
      ) : (
        <ListFrame minWidth={560}>
          {members.isPending ? (
            <SkeletonRows columns="minmax(0,1fr) 150px" count={3} />
          ) : (
            members.data.map((member) => (
              <AssignmentRow
                canManage={canManage}
                key={member.id}
                member={member}
                onChange={(roleId) => update.mutate({ member, roleId })}
                roles={ordered}
                you={member.user.id === currentUserId}
              />
            ))
          )}
        </ListFrame>
      )}
    </section>
  );
}
