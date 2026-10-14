"use client";

import "graphiql/setup-workers/webpack";
import "graphiql/style.css";
import "@graphiql/plugin-explorer/style.css";
import "./graphql-console.css";
import { explorerPlugin } from "@graphiql/plugin-explorer";
import {
  ToolbarButton,
  useGraphiQL,
  useGraphiQLActions,
  useOperationsEditorState,
} from "@graphiql/react";
import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Bookmark,
  Braces,
  Button,
  buttonVariants,
  EmptyState,
  ErrorAlert,
  IdentityChip,
  Shimmer,
  TriangleAlert,
} from "@repo/design-system";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/design-system/components/ui/alert-dialog";
import { GraphiQL, type GraphiQLProps, HISTORY_PLUGIN } from "graphiql";
import Link from "next/link";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useActiveOrganization } from "../lib/active-organization";
import { firstQueryKey, writeFlag } from "../lib/onboarding";
import { useStores } from "../lib/queries";
import { useAppTheme } from "../lib/use-app-theme";
import type { Store } from "../stores/store-labels";
import { createConsoleStorage } from "./console-storage";
import {
  type ApiVersion,
  ConsoleToolbar,
  ProductionBand,
} from "./console-toolbar";
import { EDITOR_THEME, WizdekEditorTheme } from "./editor-theme";
import { type OperationKind, operationOf } from "./operation-kind";
import { ResponseStatusBar } from "./response-status-bar";
import { createSavedQueriesPlugin } from "./saved-queries-plugin";
import {
  type ExecutionOutcome,
  useConsoleFetcher,
} from "./use-console-fetcher";

type Plugin = NonNullable<GraphiQLProps["plugins"]>[number];

const SELECTED_STORE_KEY = "selected-store";
const COST_DEBUG_KEY = "cost-debug";
const DEFAULT_QUERY = `# Pick fields in the Explorer on the left, or write a query here.
query ShopName {
  shop {
    name
  }
}
`;

/** Reads the operation about to run, so the Run button can show its risk. */
function RunToneWatcher({
  onChange,
}: {
  onChange: (kind: OperationKind) => void;
}) {
  const [query] = useOperationsEditorState();
  const operationName = useGraphiQL((state) => state.operationName);
  const { kind } = operationOf(query, operationName);
  useEffect(() => onChange(kind), [kind, onChange]);
  return null;
}

function StatusFooter(
  props: Omit<ComponentProps<typeof ResponseStatusBar>, "running">
) {
  const running = useGraphiQL((state) => state.isFetching);
  return <ResponseStatusBar {...props} running={running} />;
}

/** Opens the Saved queries panel, where the current query is saved. */
function SaveQueryButton({ plugin }: { plugin: Plugin }) {
  const { setVisiblePlugin } = useGraphiQLActions();
  return (
    <ToolbarButton label="Save query" onClick={() => setVisiblePlugin(plugin)}>
      <Bookmark aria-hidden="true" className="graphiql-toolbar-icon" />
    </ToolbarButton>
  );
}

interface PendingConfirmation {
  operationName: string | null;
  resolve: (confirmed: boolean) => void;
}

const MutationConfirm = ({
  onAnswer,
  pending,
  store,
}: {
  onAnswer: (confirmed: boolean) => void;
  pending: PendingConfirmation | null;
  store: Store | undefined;
}) => (
  <AlertDialog
    onOpenChange={(open) => {
      if (!open) {
        onAnswer(false);
      }
    }}
    open={pending !== null}
  >
    <AlertDialogContent>
      <AlertDialogHeader className="border-b-0 pb-0">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-(--status-danger-bg) text-(--status-danger-fg)">
            <TriangleAlert className="size-4" />
          </span>
          <AlertDialogTitle>Run mutation on production?</AlertDialogTitle>
        </div>
        <AlertDialogDescription className="text-[13.5px]">
          <span className="font-mono text-foreground">
            {pending?.operationName ?? "This mutation"}
          </span>{" "}
          will write to live data. This can't be undone from wizdek.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {store ? (
        <AlertDialogBody className="pt-3">
          <div className="flex items-center gap-2.5 rounded-menu border border-(--alert-danger-border) bg-[#fdf6f5] px-3 py-2.5">
            <IdentityChip id={store.id} name={store.name} size={26} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-[13px] leading-[1.3]">
                {store.name}
              </span>
              <span className="block truncate font-mono text-muted-foreground text-xs leading-[1.3]">
                {store.shopDomain}
              </span>
            </span>
            <span className="rounded-[3px] bg-(--status-danger-fg) px-[5px] py-[3px] font-mono font-semibold text-[9.5px] text-white leading-none tracking-[0.06em]">
              PROD
            </span>
          </div>
        </AlertDialogBody>
      ) : null}
      <AlertDialogFooter>
        <Button onClick={() => onAnswer(false)} variant="outline">
          Cancel
        </Button>
        <Button onClick={() => onAnswer(true)} variant="danger">
          Run on {store?.name ?? "this store"}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

function Console({
  organizationId,
  organizationName,
  stores,
  userId,
}: {
  organizationId: string;
  organizationName: string;
  stores: Store[];
  userId: string;
}) {
  const storage = useMemo(
    () => createConsoleStorage(userId, organizationId),
    [organizationId, userId]
  );
  const connected = stores.filter(({ status }) => status === "CONNECTED");
  const [storeId, setStoreId] = useState(() => {
    const remembered = storage.getItem(SELECTED_STORE_KEY);
    return (
      connected.find(({ id }) => id === remembered)?.id ??
      connected[0]?.id ??
      ""
    );
  });
  const [versions, setVersions] = useState<ApiVersion[]>([]);
  const [apiVersion, setApiVersion] = useState<string | undefined>();
  const [costDebug, setCostDebug] = useState(
    () => storage.getItem(COST_DEBUG_KEY) === "true"
  );
  const [outcome, setOutcome] = useState<ExecutionOutcome | null>(null);
  const [tone, setTone] = useState<OperationKind>("query");
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const theme = useAppTheme();
  const store = stores.find(({ id }) => id === storeId);
  const prod = store?.environment === "PROD";

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

  // Only a production mutation waits for a confirmation.
  const confirmMutation = useCallback(
    (operationName: string | null) =>
      prod
        ? new Promise<boolean>((resolve) =>
            setPending({ operationName, resolve })
          )
        : Promise.resolve(true),
    [prod]
  );
  const answer = (confirmed: boolean) => {
    pending?.resolve(confirmed);
    setPending(null);
  };
  const recordOutcome = useCallback(
    (next: ExecutionOutcome) => {
      setOutcome(next);
      if (next.kind === "response") {
        writeFlag(firstQueryKey(organizationId), true);
      }
    },
    [organizationId]
  );

  const fetcher = useConsoleFetcher({
    apiVersion,
    confirmMutation,
    costDebug,
    onOutcome: recordOutcome,
    storeId,
  });
  const savedQueries = useMemo(
    () =>
      createSavedQueriesPlugin({ organizationId, organizationName, userId }),
    [organizationId, organizationName, userId]
  );
  const plugins = useMemo(
    () => [savedQueries, HISTORY_PLUGIN, explorerPlugin()],
    [savedQueries]
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
  let runTone = "query";
  if (tone === "mutation") {
    runTone = prod ? "mutation-prod" : "mutation";
  }

  return (
    <div className="flex min-h-[620px] flex-1 flex-col">
      <ConsoleToolbar
        apiVersion={apiVersion ?? ""}
        costDebug={costDebug}
        onApiVersionChange={setApiVersion}
        onCostDebugChange={changeCostDebug}
        onStoreChange={changeStore}
        organizationName={organizationName}
        store={store}
        stores={stores}
        versions={versions}
      />
      {store && prod ? <ProductionBand store={store} /> : null}
      <div className="graphql-console min-h-0 flex-1" data-run-tone={runTone}>
        <GraphiQL
          defaultQuery={DEFAULT_QUERY}
          editorTheme={{ dark: EDITOR_THEME, light: EDITOR_THEME }}
          fetcher={fetcher}
          forcedTheme={theme}
          isHeadersEditorEnabled={false}
          plugins={plugins}
          storage={storage}
        >
          <GraphiQL.Toolbar>
            {({ copy, merge, prettify }) => (
              <>
                {prettify}
                {copy}
                {merge}
                <SaveQueryButton plugin={savedQueries} />
              </>
            )}
          </GraphiQL.Toolbar>
          <GraphiQL.Footer>
            <RunToneWatcher onChange={setTone} />
            <WizdekEditorTheme />
            <StatusFooter
              apiVersion={apiVersion ?? ""}
              outcome={outcome}
              shopDomain={store?.shopDomain ?? ""}
            />
          </GraphiQL.Footer>
        </GraphiQL>
      </div>
      <MutationConfirm onAnswer={answer} pending={pending} store={store} />
    </div>
  );
}

const ConsoleState = ({ children }: { children: ReactNode }) => (
  <div className="grid flex-1 place-items-center px-6 py-10">{children}</div>
);

export function GraphqlConsole({ userId }: { userId: string }) {
  const { organization } = useActiveOrganization();
  const organizationId = organization?.id ?? null;
  const stores = useStores(organizationId);

  if (stores.isError) {
    return (
      <div className="p-8">
        <ErrorAlert
          message={getApiErrorMessage(stores.error, "Could not load stores.")}
          onRetry={() => stores.refetch()}
          title="Couldn't load stores."
        />
      </div>
    );
  }
  if (!(organization && stores.data)) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4" role="status">
        <span className="sr-only">Loading console</span>
        <Shimmer className="h-9 w-80" />
        <Shimmer className="h-full min-h-[480px] w-full" />
      </div>
    );
  }
  if (!stores.data.some(({ status }) => status === "CONNECTED")) {
    return (
      <ConsoleState>
        <EmptyState
          action={
            <Link className={buttonVariants()} href="/stores/new">
              Connect store
            </Link>
          }
          className="w-full max-w-[520px]"
          description="The console runs Admin GraphQL against a connected store. Connect one, then come back."
          icon={<Braces />}
          title="No connected store"
        />
      </ConsoleState>
    );
  }

  // Keyed by organization: tabs and history are stored per organization.
  return (
    <Console
      key={organization.id}
      organizationId={organization.id}
      organizationName={organization.name}
      stores={stores.data}
      userId={userId}
    />
  );
}
