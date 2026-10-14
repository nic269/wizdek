"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { toast } from "@repo/design-system";
import { useState } from "react";
import { useActiveOrganization } from "../lib/active-organization";

/** Creates an organization, switches to it, and says so in a toast. */
export const useCreateOrganization = () => {
  const { refresh, setOrganizationId } = useActiveOrganization();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const create = async (rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      setError("Enter a name for the organization.");
      return false;
    }
    setError(null);
    setIsPending(true);
    try {
      const { data } = await apiClient.organizations.create({ name });
      await refresh();
      setOrganizationId(data.id);
      toast.success("Organization created", {
        description: "You are its Owner.",
      });
      return true;
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not create the organization."));
      return false;
    } finally {
      setIsPending(false);
    }
  };

  return { create, error, isPending };
};
