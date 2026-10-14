"use client";

import {
  Activity,
  Boxes,
  Button,
  buttonVariants,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  cn,
  EmptyState,
  EnvTag,
  ErrorAlert,
  IdentityChip,
  Input,
  LoaderCircle,
  PageHeader,
  Plus,
  ReadOnlyBanner,
  Search,
  SegmentedControl,
  SkeletonRows,
  StatusBadge,
  Store as StoreIcon,
} from "@repo/design-system";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useActiveOrganization } from "../lib/active-organization";
import { formatRelative } from "../lib/format";
import { usePermissions } from "../lib/permissions";
import { queryKeys, useShopifyApps, useStores } from "../lib/queries";
import { StoreDrawer, useHealthCheck } from "./store-drawer";
import {
  needsAttention,
  STRATEGY_ICONS,
  STRATEGY_LABELS,
  type Store,
  usesOwnWebhookSecret,
} from "./store-labels";

type Filter = "all" | "attention" | "prod";

const COLUMNS = "minmax(240px,2.2fr) 130px 190px 90px 110px 110px";

const lastChecked = (store: Store) => {
  if (store.status === "PENDING") {
    return "Awaiting install";
  }
  return store.lastHealthCheckAt
    ? `Checked ${formatRelative(store.lastHealthCheckAt)}`
    : "Not checked yet";
};

const WebhookCell = ({ store }: { store: Store }) => {
  if (!usesOwnWebhookSecret(store)) {
    return <span className="text-[12.5px] text-muted-foreground">Via app</span>;
  }
  return store.hasWebhookSecret ? (
    <span className="inline-flex items-center gap-1.5 text-(--status-success-fg) text-[12.5px]">
      <CircleCheck className="size-3.5" />
      Secret set
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
      <CircleDashed className="size-3.5" />
      Missing
    </span>
  );
};

const StoreRow = ({
  checking,
  onCheck,
  onOpen,
  store,
}: {
  checking: boolean;
  onCheck: () => void;
  onOpen: () => void;
  store: Store;
}) => (
  <TableRow
    className="cursor-pointer"
    data-testid={`store-${store.shopDomain}`}
    onClick={onOpen}
  >
    <TableCell className="h-[62px]">
      <div className="flex min-w-0 items-center gap-[11px]">
        <IdentityChip
          className="rounded-[7px]!"
          id={store.id}
          name={store.name}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-[7px]">
            <span className="truncate font-semibold text-[13.5px] text-foreground leading-[1.3]">
              {store.name}
            </span>
            <EnvTag environment={store.environment} />
          </div>
          <div className="truncate font-mono text-muted-foreground text-xs leading-[1.4]">
            {store.shopDomain}
          </div>
        </div>
      </div>
    </TableCell>
    <TableCell>
      <span className="flex items-center gap-[7px] text-[13px] [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
        {STRATEGY_ICONS[store.strategy]}
        {STRATEGY_LABELS[store.strategy]}
      </span>
    </TableCell>
    <TableCell>
      <div className="flex flex-col items-start gap-1">
        <StatusBadge status={store.status} />
        <span className="text-[11.5px] text-muted-foreground leading-none">
          {checking ? "Checking…" : lastChecked(store)}
        </span>
      </div>
    </TableCell>
    <TableCell className="font-medium font-mono text-[13px]">
      {store.scopes.length > 0 ? store.scopes.length : "—"}
    </TableCell>
    <TableCell>
      <WebhookCell store={store} />
    </TableCell>
    <TableCell>
      <div className="flex justify-end gap-1">
        <Button
          aria-label={`Check health of ${store.name}`}
          disabled={checking}
          onClick={(event) => {
            event.stopPropagation();
            onCheck();
          }}
          size="icon-sm"
          title="Check health"
          variant="outline"
        >
          {checking ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Activity className="size-3.5" />
          )}
        </Button>
        {store.status === "RECONNECT_REQUIRED" ? (
          <Button
            className="border-(--alert-warning-border) bg-(--status-warning-bg) text-(--status-warning-fg) text-[12.5px] hover:bg-(--status-warning-bg)/80"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            size="sm"
            variant="outline"
          >
            Reconnect
          </Button>
        ) : (
          <Button
            aria-label={`Open ${store.name}`}
            className="text-muted-foreground"
            size="icon-sm"
            title="Open"
            variant="ghost"
          >
            <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
    </TableCell>
  </TableRow>
);

const StoresHeader = ({
  appCount,
  canManage,
  organizationName,
}: {
  appCount: number | undefined;
  canManage: boolean;
  organizationName: string | undefined;
}) => (
  <PageHeader
    actions={
      <>
        <Link
          className={buttonVariants({ variant: "outline" })}
          href="/stores/apps"
        >
          <Boxes />
          Shopify apps
          {appCount === undefined ? null : (
            <span className="rounded bg-sunken px-[5px] py-0.5 font-medium font-mono text-[11px] text-muted-foreground">
              {appCount}
            </span>
          )}
        </Link>
        {canManage ? (
          <Link className={buttonVariants()} href="/stores/new">
            <Plus />
            Connect store
          </Link>
        ) : null}
      </>
    }
    description={`Shopify stores connected to ${organizationName ?? "this organization"}. Open a store for health, scopes and webhook settings.`}
    title="Stores"
  />
);

const StoresTable = ({
  checking,
  isLoading,
  onCheck,
  onOpen,
  rows,
}: {
  checking: string | null;
  isLoading: boolean;
  onCheck: (store: Store) => void;
  onOpen: (storeId: string) => void;
  rows: Store[];
}) => (
  <Table className="min-w-[900px] table-fixed">
    <TableHeader>
      <TableRow>
        <TableHead>Store</TableHead>
        <TableHead className="w-[146px]">Connection</TableHead>
        <TableHead className="w-[206px]">Status</TableHead>
        <TableHead className="w-[90px]">Scopes</TableHead>
        <TableHead className="w-[126px]">Webhooks</TableHead>
        <TableHead className="w-[126px] text-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {isLoading ? (
        <TableRow className="hover:bg-transparent">
          <TableCell className="h-auto p-0" colSpan={6}>
            <SkeletonRows columns={COLUMNS} label="Loading stores" />
          </TableCell>
        </TableRow>
      ) : (
        rows.map((store) => (
          <StoreRow
            checking={checking === store.id}
            key={store.id}
            onCheck={() => onCheck(store)}
            onOpen={() => onOpen(store.id)}
            store={store}
          />
        ))
      )}
      {!isLoading && rows.length === 0 ? (
        <TableRow className="hover:bg-transparent">
          <TableCell
            className={cn(
              "h-auto py-8 text-center text-[13.5px] text-muted-foreground"
            )}
            colSpan={6}
          >
            No stores match this filter.
          </TableCell>
        </TableRow>
      ) : null}
    </TableBody>
  </Table>
);

export function StoresPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { organization } = useActiveOrganization();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const organizationId = organization?.id ?? null;
  const stores = useStores(organizationId);
  const apps = useShopifyApps(organizationId);
  const { check, checking } = useHealthCheck(organizationId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const canManage = can("stores:manage");

  const all = stores.data ?? [];
  const attention = all.filter(needsAttention);
  const production = all.filter(({ environment }) => environment === "PROD");
  const needle = query.trim().toLowerCase();
  const scoped = { all, attention, prod: production }[filter];
  const rows = scoped.filter(
    (store) =>
      !needle ||
      `${store.name} ${store.shopDomain}`.toLowerCase().includes(needle)
  );
  const isLoading = stores.isLoading || permissionsLoading;
  const isEmpty = !(isLoading || stores.isError) && all.length === 0;
  const openId = searchParams.get("store");
  const open = all.find(({ id }) => id === openId) ?? null;

  const setOpen = (storeId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (storeId) {
      params.set("store", storeId);
    } else {
      params.delete("store");
    }
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, {
      scroll: false,
    });
  };
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.stores(organizationId),
    });

  return (
    <>
      <StoresHeader
        appCount={apps.data?.length}
        canManage={canManage}
        organizationName={organization?.name}
      />

      {permissionsLoading || canManage ? null : (
        <ReadOnlyBanner>
          You can view stores but not change them. Ask an Owner for the{" "}
          <strong>Manage Shopify stores</strong> permission to connect,
          reconnect or disconnect.
        </ReadOnlyBanner>
      )}
      {stores.isError ? (
        <ErrorAlert
          message="Your connections are unaffected."
          onRetry={() => stores.refetch()}
          title="Couldn't load stores."
        />
      ) : null}

      {isEmpty || stores.isError ? null : (
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-[0_1_300px]">
            <Search className="pointer-events-none absolute top-[9.5px] left-2.5 size-[15px] text-muted-foreground" />
            <Input
              aria-label="Filter stores"
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name or domain"
              type="search"
              value={query}
            />
          </div>
          <SegmentedControl
            aria-label="Show"
            onValueChange={setFilter}
            options={[
              { count: all.length, label: "All", value: "all" },
              {
                count: attention.length,
                label: "Needs attention",
                value: "attention",
              },
              { count: production.length, label: "Production", value: "prod" },
            ]}
            value={filter}
          />
        </div>
      )}

      {isEmpty ? (
        <EmptyState
          action={
            canManage ? (
              <Link className={buttonVariants()} href="/stores/new">
                <Plus />
                Connect your first store
              </Link>
            ) : undefined
          }
          description="Connect a store to run GraphQL against it, build flows and receive webhooks. It takes about a minute with an access token."
          icon={<StoreIcon />}
          note={canManage ? undefined : "Only Owners can connect stores."}
          title="No stores connected yet"
        />
      ) : null}

      {isEmpty || stores.isError ? null : (
        <StoresTable
          checking={checking}
          isLoading={isLoading}
          onCheck={check}
          onOpen={setOpen}
          rows={rows}
        />
      )}

      <StoreDrawer
        canManage={canManage}
        checking={checking === open?.id}
        onCheck={() => open && check(open)}
        onClose={() => setOpen(null)}
        onRefresh={refresh}
        store={open}
      />
    </>
  );
}
