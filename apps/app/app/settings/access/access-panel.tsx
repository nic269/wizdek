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
    <div className="flex flex-col gap-[26px]">
      {canManageMembers && can("roles:manage") ? null : (
        <ReadOnlyBanner>
          You can view access settings but not change them. Changing roles needs{" "}
          <strong>members:manage</strong>; creating roles needs{" "}
          <strong>roles:manage</strong>.
        </ReadOnlyBanner>
      )}
      {canReadRoles ? (
        <RolesSection
          canManage={can("roles:manage")}
          organizationId={organizationId}
        />
      ) : null}
      {canReadMembers ? (
        <RoleAssignments
          canManage={canManageMembers && canReadRoles}
          currentUserId={currentUserId}
          organizationId={organizationId}
          roles={roles.data ?? []}
        />
      ) : null}
      {canReadAudit ? (
        <AuditLog organizationId={organizationId} />
      ) : (
        <ReadOnlyBanner>
          The audit log needs <strong>audit:read</strong>.
        </ReadOnlyBanner>
      )}
    </div>
  );
}
