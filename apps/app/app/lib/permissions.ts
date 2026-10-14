"use client";

import { apiClient } from "@repo/api/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useActiveOrganization } from "./active-organization";

/** A permission as the catalog names it, such as `stores:manage`. */
export type Permission = `${string}:${string}`;

/**
 * The permissions the signed-in user holds in the active organization. The
 * server stays the authority; this only decides which actions to offer.
 */
export const usePermissions = () => {
  const { organization } = useActiveOrganization();
  const organizationId = organization?.id ?? null;
  const query = useQuery({
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data } = await apiClient.organizations.permissions({
        organizationId: organizationId ?? "",
      });
      return new Set(data.permissions);
    },
    queryKey: ["permissions", organizationId],
    staleTime: 60_000,
  });
  const granted = query.data;
  const can = useCallback(
    (permission: Permission) => granted?.has(permission) ?? false,
    [granted]
  );
  return {
    can,
    /** True until the permissions of the active organization are known. */
    isLoading: Boolean(organizationId) && query.isPending,
  };
};
