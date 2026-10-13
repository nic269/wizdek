"use client";

import "graphiql/setup-workers/webpack";
import "graphiql/style.css";
import "@graphiql/plugin-explorer/style.css";
import "./graphql-console.css";
import { explorerPlugin } from "@graphiql/plugin-explorer";
import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  buttonVariants,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@repo/design-system";
import { GraphiQL, HISTORY_PLUGIN } from "graphiql";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveOrganization } from "../lib/active-organization";
import { useAppTheme } from "../lib/use-app-theme";
import type { Store } from "../stores/store-labels";
import { createConsoleStorage } from "./console-storage";
import { type ApiVersion, ConsoleToolbar } from "./console-toolbar";
import { ResponseStatusBar } from "./response-status-bar";
import { createSavedQueriesPlugin } from "./saved-queries-plugin";
import {
  type ExecutionOutcome,
  useConsoleFetcher,
} from "./use-console-fetcher";

const SELECTED_STORE_KEY = "selected-store";
const COST_DEBUG_KEY = "cost-debug";
const DEFAULT_QUERY = `# Pick fields in the Explorer on the left, or write a query here.
query ShopName {
  shop {
    name
  }
}
`;

function Console({
  organizationId,
  stores,
  userId,
}: {
  organizationId: string;
  stores: Store[];
  userId: string;
}) {
  const storage = useMemo(
    () => createConsoleStorage(userId, organizationId),
    [organizationId, userId]
  );
  const [storeId, setStoreId] = useState(() => {
    const remembered = storage.getItem(SELECTED_STORE_KEY);
    return (
      stores.find(({ id }) => id === remembered)?.id ?? stores[0]?.id ?? ""
    );
  });
  const [versions, setVersions] = useState<ApiVersion[]>([]);
  const [apiVersion, setApiVersion] = useState<string | undefined>();
  const [costDebug, setCostDebug] = useState(
    () => storage.getItem(COST_DEBUG_KEY) === "true"
  );
  const [outcome, setOutcome] = useState<ExecutionOutcome | null>(null);
  const theme = useAppTheme();
  const store = stores.find(({ id }) => id === storeId);

  useEffect(() => {
    if (!store) {
      return;
    }
    let isCurrent = true;
    // Until the store answers, offer the version it was connected with.
    setVersions([
      {
        displayName: store.apiVersion,
        handle: store.apiVersion,
        supported: true,
      },
    ]);
    setApiVersion(store.apiVersion);
    apiClient.shopifyGraphql
      .versions({ storeId: store.id })
      .then(({ data }) => {
        if (isCurrent && data.versions.length > 0) {
          setVersions(data.versions);
        }
      })
      .catch(() => {
        // The stored version stays selectable; a run reports the real error.
      });
    return () => {
      isCurrent = false;
    };
  }, [store]);

  const fetcher = useConsoleFetcher({
    apiVersion,
    costDebug,
    onOutcome: setOutcome,
    storeId,
  });
  const plugins = useMemo(
    () => [
      HISTORY_PLUGIN,
      explorerPlugin(),
      createSavedQueriesPlugin(organizationId),
    ],
    [organizationId]
  );

  const changeStore = useCallback(
    (nextStoreId: string) => {
      storage.setItem(SELECTED_STORE_KEY, nextStoreId);
      setStoreId(nextStoreId);
      setOutcome(null);
    },
    [storage]
  );
  const changeCostDebug = useCallback(
    (next: boolean) => {
      storage.setItem(COST_DEBUG_KEY, String(next));
      setCostDebug(next);
    },
    [storage]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold text-foreground text-xl">
          GraphQL console
        </h1>
        <ConsoleToolbar
          apiVersion={apiVersion ?? ""}
          costDebug={costDebug}
          onApiVersionChange={setApiVersion}
          onCostDebugChange={changeCostDebug}
          onStoreChange={changeStore}
          storeId={storeId}
          stores={stores}
          versions={versions}
        />
      </div>
      <div className="graphql-console overflow-hidden rounded-md border">
        <GraphiQL
          defaultQuery={DEFAULT_QUERY}
          fetcher={fetcher}
          forcedTheme={theme}
          isHeadersEditorEnabled={false}
          plugins={plugins}
          storage={storage}
        >
          <GraphiQL.Footer>
            <ResponseStatusBar outcome={outcome} />
          </GraphiQL.Footer>
        </GraphiQL>
      </div>
    </div>
  );
}

export function GraphqlConsole({ userId }: { userId: string }) {
  const {
    error: organizationError,
    isLoading,
    organization,
  } = useActiveOrganization();
  const organizationId = organization?.id;
  const [stores, setStores] = useState<Store[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) {
      return;
    }
    setStores(null);
    setError(null);
    apiClient.shopifyStores
      .list({ organizationId })
      .then(({ data }) =>
        setStores(data.filter(({ status }) => status === "CONNECTED"))
      )
      .catch((cause: unknown) =>
        setError(getApiErrorMessage(cause, "Could not load stores."))
      );
  }, [organizationId]);

  if (organizationError || error) {
    return <ErrorState message={organizationError ?? error ?? ""} />;
  }
  if (!(isLoading || organization)) {
    return (
      <EmptyState
        description="Create an organization on the dashboard first."
        title="No organization"
      />
    );
  }
  if (!(organizationId && stores)) {
    return <LoadingState label="Loading stores" />;
  }
  if (stores.length === 0) {
    return (
      <EmptyState
        action={
          <a className={buttonVariants()} href="/stores/new">
            Connect store
          </a>
        }
        description="The console needs a connected store to query."
        title="No connected store"
      />
    );
  }

  // Keyed by organization: tabs and history are stored per organization.
  return (
    <Console
      key={organizationId}
      organizationId={organizationId}
      stores={stores}
      userId={userId}
    />
  );
}
