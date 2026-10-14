"use client";

import { apiClient } from "@repo/api/client";
import { useQuery } from "@tanstack/react-query";

/**
 * Shared queries for organization-wide lists. The shell, the dashboard and
 * the list screens read the same keys, so one fetch serves them all.
 */
export const queryKeys = {
  backups: (organizationId: string | null) => ["backups", organizationId],
  connections: (organizationId: string | null) => [
    "database-connections",
    organizationId,
  ],
  flows: (organizationId: string | null) => ["flows", organizationId],
  runs: (organizationId: string | null) => ["org-runs", organizationId],
  stores: (organizationId: string | null) => ["stores", organizationId],
} as const;

export type Store = Awaited<
  ReturnType<typeof apiClient.shopifyStores.list>
>["data"][number];
export type FlowListItem = Awaited<
  ReturnType<typeof apiClient.flows.list>
>["data"][number];
export type OrganizationRun = Awaited<
  ReturnType<typeof apiClient.flows.runs.listForOrganization>
>["data"][number];
export type DatabaseConnection = Awaited<
  ReturnType<typeof apiClient.databaseConnections.list>
>["data"][number];
export type DatabaseBackup = Awaited<
  ReturnType<typeof apiClient.databaseBackups.listForOrganization>
>["data"][number];

const ACTIVE_RUN_STATUSES = new Set(["QUEUED", "RUNNING"]);

export const isRunActive = (status: string) => ACTIVE_RUN_STATUSES.has(status);

export const useStores = (organizationId: string | null, enabled = true) =>
  useQuery({
    enabled: Boolean(organizationId) && enabled,
    queryFn: async () =>
      (
        await apiClient.shopifyStores.list({
          organizationId: organizationId ?? "",
        })
      ).data,
    queryKey: queryKeys.stores(organizationId),
  });

export const useFlows = (organizationId: string | null, enabled = true) =>
  useQuery({
    enabled: Boolean(organizationId) && enabled,
    queryFn: async () =>
      (await apiClient.flows.list({ organizationId: organizationId ?? "" }))
        .data,
    queryKey: queryKeys.flows(organizationId),
  });

/** The newest runs across the organization's flows; polls while any is active. */
export const useOrganizationRuns = (
  organizationId: string | null,
  enabled = true
) =>
  useQuery({
    enabled: Boolean(organizationId) && enabled,
    queryFn: async () =>
      (
        await apiClient.flows.runs.listForOrganization({
          limit: 20,
          organizationId: organizationId ?? "",
        })
      ).data,
    queryKey: queryKeys.runs(organizationId),
    refetchInterval: (query) =>
      query.state.data?.some(({ status }) => isRunActive(status))
        ? 5000
        : false,
  });

export const useDatabaseConnections = (
  organizationId: string | null,
  enabled = true
) =>
  useQuery({
    enabled: Boolean(organizationId) && enabled,
    queryFn: async () =>
      (
        await apiClient.databaseConnections.list({
          organizationId: organizationId ?? "",
        })
      ).data,
    queryKey: queryKeys.connections(organizationId),
  });

export const useOrganizationBackups = (
  organizationId: string | null,
  enabled = true
) =>
  useQuery({
    enabled: Boolean(organizationId) && enabled,
    queryFn: async () =>
      (
        await apiClient.databaseBackups.listForOrganization({
          organizationId: organizationId ?? "",
        })
      ).data,
    queryKey: queryKeys.backups(organizationId),
  });
