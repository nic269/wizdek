"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { OptionSelect } from "./option-select";

export type Organization = Awaited<
  ReturnType<typeof apiClient.organizations.list>
>["data"][number];

interface ActiveOrganizationValue {
  error: string | null;
  isLoading: boolean;
  /** The selected organization, or null while loading or when there is none. */
  organization: Organization | null;
  organizations: Organization[];
  /** Reloads the list, for example after an organization was created. */
  refresh: () => Promise<void>;
  setOrganizationId: (organizationId: string) => void;
}

interface ProviderValue extends ActiveOrganizationValue {
  ensureLoaded: () => void;
}

const STORAGE_KEY = "active-organization-id";

const ActiveOrganizationContext = createContext<ProviderValue | null>(null);

const readStoredId = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStoredId = (organizationId: string) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, organizationId);
  } catch {
    // Storage can be unavailable; the selection then lasts for this page only.
  }
};

export function ActiveOrganizationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationIdState] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requested = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.organizations.list({});
      const stored = readStoredId();
      setOrganizations(data);
      setOrganizationIdState(
        (current) =>
          data.find(({ id }) => id === current)?.id ??
          data.find(({ id }) => id === stored)?.id ??
          data[0]?.id ??
          null
      );
      setError(null);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not load organizations."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Organizations load when the first consumer mounts, so signed-out pages
  // that share this provider never call the API.
  const ensureLoaded = useCallback(() => {
    if (requested.current) {
      return;
    }
    requested.current = true;
    refresh();
  }, [refresh]);

  const setOrganizationId = useCallback((nextId: string) => {
    writeStoredId(nextId);
    setOrganizationIdState(nextId);
  }, []);

  const value = useMemo<ProviderValue>(
    () => ({
      ensureLoaded,
      error,
      isLoading,
      organization:
        organizations.find(({ id }) => id === organizationId) ?? null,
      organizations,
      refresh,
      setOrganizationId,
    }),
    [
      ensureLoaded,
      error,
      isLoading,
      organizationId,
      organizations,
      refresh,
      setOrganizationId,
    ]
  );

  return (
    <ActiveOrganizationContext.Provider value={value}>
      {children}
    </ActiveOrganizationContext.Provider>
  );
}

export const useActiveOrganization = (): ActiveOrganizationValue => {
  const value = useContext(ActiveOrganizationContext);
  if (!value) {
    throw new Error(
      "useActiveOrganization must be used inside ActiveOrganizationProvider."
    );
  }
  const { ensureLoaded, ...rest } = value;
  useEffect(ensureLoaded, [ensureLoaded]);
  return rest;
};

export function OrganizationSwitcher() {
  const { isLoading, organization, organizations, setOrganizationId } =
    useActiveOrganization();

  if (isLoading || organizations.length === 0) {
    return null;
  }

  return (
    <OptionSelect
      aria-label="Active organization"
      className="bg-card"
      onValueChange={setOrganizationId}
      options={organizations.map(({ id, name }) => ({
        label: name,
        value: id,
      }))}
      placeholder="Choose organization"
      value={organization?.id ?? null}
    />
  );
}
