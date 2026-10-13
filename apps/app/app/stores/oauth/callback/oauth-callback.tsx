"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  buttonVariants,
  ErrorState,
  LoadingState,
} from "@repo/design-system";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveOrganization } from "../../../lib/active-organization";

interface Candidate {
  organizationId: string;
  storeId: string;
}

const isCandidate = (value: unknown): value is Candidate =>
  typeof value === "object" &&
  value !== null &&
  "organizationId" in value &&
  typeof value.organizationId === "string" &&
  "storeId" in value &&
  typeof value.storeId === "string";

/** Several pending installs can match one shop; the API then lists them. */
const candidatesFrom = (error: unknown): Candidate[] => {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return [];
  }
  const { data } = error;
  if (typeof data !== "object" || data === null || !("candidates" in data)) {
    return [];
  }
  return Array.isArray(data.candidates)
    ? data.candidates.filter(isCandidate)
    : [];
};

export function OAuthCallback() {
  const router = useRouter();
  const { organizations } = useActiveOrganization();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(true);
  const started = useRef(false);

  const complete = useCallback(
    async (storeId?: string) => {
      setError(null);
      setIsCompleting(true);
      try {
        await apiClient.shopifyStores.completeOAuth({
          query: window.location.search.slice(1),
          ...(storeId ? { storeId } : {}),
        });
        router.replace("/stores");
      } catch (cause) {
        const options = candidatesFrom(cause);
        setCandidates(options);
        if (options.length === 0) {
          setError(getApiErrorMessage(cause, "Could not connect the store."));
        }
        setIsCompleting(false);
      }
    },
    [router]
  );

  useEffect(() => {
    // The callback carries a single-use authorization; run it exactly once.
    if (started.current) {
      return;
    }
    started.current = true;
    complete();
  }, [complete]);

  if (isCompleting) {
    return <LoadingState label="Connecting the store" />;
  }

  if (candidates.length > 0) {
    return (
      <div className="max-w-xl space-y-3">
        <p className="text-sm">
          This store has a pending install in several organizations. Choose
          where to connect it.
        </p>
        <ul className="divide-y rounded-md border">
          {candidates.map((candidate) => (
            <li
              className="flex items-center justify-between gap-3 px-3 py-2"
              key={candidate.storeId}
            >
              <span className="text-sm">
                {organizations.find(({ id }) => id === candidate.organizationId)
                  ?.name ?? candidate.organizationId}
              </span>
              <Button onClick={() => complete(candidate.storeId)} size="sm">
                Connect here
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-3">
      <ErrorState
        message={error ?? "Could not connect the store."}
        title="Store not connected"
      />
      <a className={buttonVariants({ variant: "outline" })} href="/stores/new">
        Start again
      </a>
    </div>
  );
}
