"use client";

import {
  EmptyState,
  Lock,
  ReadOnlyBanner,
  SkeletonRows,
} from "@repo/design-system";
import { useActiveOrganization } from "../../lib/active-organization";
import { usePermissions } from "../../lib/permissions";
import { ListFrame, useRoles } from "../people";
import { AuditLog } from "./audit-log";
import { RoleAssignments } from "./role-assignments";
import { RolesSection } from "./roles-section";

/** Roles, role assignments and the audit log, each shown to those allowed. */
export function AccessPanel({ currentUserId }: { currentUserId: string }) {
  const { organization } = useActiveOrganization();
  const { can, isLoading } = usePermissions();
  const organizationId = organization?.id ?? null;
  const canReadRoles = can("roles:read");
  // Assignments offer every role, so they read the roles list too.
  const roles = useRoles(organizationId, canReadRoles);

  if (!organizationId || isLoading) {
    return (
      <ListFrame minWidth={560}>
        <SkeletonRows columns="minmax(0,1fr) 150px" count={4} />
      </ListFrame>
    );
  }

  const canReadMembers = can("members:read");
  const canReadAudit = can("audit:read");
  if (!(canReadRoles || canReadMembers || canReadAudit)) {
    return (
      <EmptyState
        description="Access needs the roles:read, members:read or audit:read permission. Ask an Owner for access."
        icon={<Lock />}
        title="You don't have permission to see access settings"
      />
    );
  }

  const canManageMembers = can("members:manage");
  return (
    <div className="flex flex-col gap-6">
      {canManageMembers && can("roles:manage") ? null : (
        <ReadOnlyBanner>
          You can view access settings but not change them. Changing roles needs{" "}
          <strong>members:manage</strong>; creating roles needs{" "}
          <strong>roles:manage</strong>.
        </ReadOnlyBanner>
      )}
      <div className="grid items-start gap-6 min-[1400px]:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-6">
          {canReadMembers ? (
            <RoleAssignments
              canManage={canManageMembers && canReadRoles}
              currentUserId={currentUserId}
              organizationId={organizationId}
              roles={roles.data ?? []}
            />
          ) : null}
          {canReadRoles ? (
            <RolesSection
              canManage={can("roles:manage")}
              organizationId={organizationId}
            />
          ) : null}
        </div>
        <div className="min-w-0">
          {canReadAudit ? (
            <AuditLog organizationId={organizationId} />
          ) : (
            <ReadOnlyBanner>
              The audit log needs <strong>audit:read</strong>.
            </ReadOnlyBanner>
          )}
        </div>
      </div>
    </div>
  );
}
