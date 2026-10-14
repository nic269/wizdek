"use client";

import { apiClient } from "@repo/api/client";
import {
  Activity,
  BellDot,
  Braces,
  buttonVariants,
  Check,
  CircleHelp,
  cn,
  Database,
  EnvTag,
  ErrorAlert,
  HardDrive,
  hueFromId,
  KeyRound,
  PageHeader,
  Plus,
  Shimmer,
  StatusBadge,
  Store,
  Webhook,
  Workflow,
} from "@repo/design-system";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { useActiveOrganization } from "../lib/active-organization";
import {
  formatBytes,
  formatDuration,
  formatRelative,
  formatWhen,
  plural,
} from "../lib/format";
import {
  firstQueryKey,
  onboardingHiddenKey,
  readFlag,
  writeFlag,
} from "../lib/onboarding";
import { type Permission, usePermissions } from "../lib/permissions";
import {
  type DatabaseBackup,
  type DatabaseConnection,
  type OrganizationRun,
  type Store as StoreRecord,
  useDatabaseConnections,
  useFlows,
  useOrganizationBackups,
  useOrganizationRuns,
  useShopifyApps,
  useStores,
} from "../lib/queries";
import { RunItemsBar, summarizeItems } from "../lib/run-items-bar";
import {
  OnboardingChecklist,
  type OnboardingStep,
} from "./onboarding-checklist";

const ENVIRONMENT_WORDS = {
  DEV: "development",
  PROD: "production",
  STAGING: "staging",
} as const;
const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five"];

const greetingFor = (hour: number) => {
  if (hour < 12) {
    return "Good morning";
  }
  return hour < 18 ? "Good afternoon" : "Good evening";
};

interface AttentionItem {
  cta: string;
  description: string;
  href: string;
  icon: ReactNode;
  key: string;
  title: string;
  tone: "unknown" | "warning" | "danger" | "neutral";
}

const ATTENTION_TONES: Record<AttentionItem["tone"], string> = {
  danger: "bg-(--status-danger-bg) text-(--status-danger-fg)",
  neutral: "bg-(--status-neutral-bg) text-(--status-neutral-fg)",
  unknown: "bg-(--status-unknown-bg) text-white",
  warning: "bg-(--status-warning-bg) text-(--status-warning-fg)",
};

/** Ordered by severity: unknown items, reconnects, unreachable databases, missing secrets. */
const attentionItems = (input: {
  backups: DatabaseBackup[];
  connections: DatabaseConnection[];
  runs: OrganizationRun[];
  stores: StoreRecord[];
}): AttentionItem[] => {
  const unknown = input.runs
    .filter(({ itemCounts }) => (itemCounts.UNKNOWN ?? 0) > 0)
    .map<AttentionItem>((run) => ({
      cta: "Review",
      description: `${run.flowName} · run #${run.number} on ${run.storeName} (${ENVIRONMENT_WORDS[run.storeEnvironment]}). Their effect may or may not have been applied — check them in Shopify.`,
      href: `/flows/${run.flowId}/runs/${run.id}?status=UNKNOWN`,
      icon: <CircleHelp />,
      key: `unknown-${run.id}`,
      title: `${plural(run.itemCounts.UNKNOWN ?? 0, "item")} in an unknown state`,
      tone: "unknown",
    }));
  const reconnect = input.stores
    .filter(({ status }) => status === "RECONNECT_REQUIRED")
    .map<AttentionItem>((store) => ({
      cta: "Reconnect",
      description: `${store.lastHealthCheckError ?? "Shopify refused the store's credentials."} Flows targeting this store will fail until it's reconnected.`,
      href: `/stores?store=${store.id}`,
      icon: <KeyRound />,
      key: `reconnect-${store.id}`,
      title: `${store.name} needs to be reconnected`,
      tone: "warning",
    }));
  const latestBackup = new Map<string, DatabaseBackup>();
  for (const backup of input.backups) {
    if (backup.connectionId && !latestBackup.has(backup.connectionId)) {
      latestBackup.set(backup.connectionId, backup);
    }
  }
  const databases = input.connections
    .filter(
      ({ id, lastCheckError }) =>
        lastCheckError || latestBackup.get(id)?.status === "FAILED"
    )
    .map<AttentionItem>((connection) => {
      const failed = latestBackup.get(connection.id);
      return {
        cta: "Open",
        description: connection.lastCheckError
          ? connection.lastCheckError
          : `The last backup failed: ${failed?.error ?? "no reason recorded"}.`,
        href: `/database/${connection.id}`,
        icon: <Database />,
        key: `database-${connection.id}`,
        title: connection.lastCheckError
          ? `${connection.name} is unreachable`
          : `The last backup of ${connection.name} failed`,
        tone: "danger",
      };
    });
  const secrets = input.stores
    .filter(
      ({ hasWebhookSecret, status, strategy }) =>
        status === "CONNECTED" &&
        strategy === "STATIC_TOKEN" &&
        !hasWebhookSecret
    )
    .map<AttentionItem>((store) => ({
      cta: "Add secret",
      description:
        "Webhook-triggered flows can't verify payloads from this store.",
      href: `/stores?store=${store.id}`,
      icon: <Webhook />,
      key: `secret-${store.id}`,
      title: `Webhook secret missing on ${store.name}`,
      tone: "neutral",
    }));
  return [...unknown, ...reconnect, ...databases, ...secrets];
};

const Section = ({
  action,
  children,
  icon,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) => (
  <section className="overflow-hidden rounded-card border border-border">
    <div className="flex items-center gap-2.5 border-border border-b px-4 py-3.5">
      <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <h2 className="flex-1 font-semibold text-sm leading-[1.2]">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

const SectionLink = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <Link
    className="font-medium text-[12.5px] text-accent-ink hover:underline"
    href={href}
  >
    {children}
  </Link>
);

const rowClass =
  "flex w-full items-center gap-3 border-border border-b px-4 text-left text-foreground last:border-b-0 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none";

const SkeletonList = ({ withIcon = false }: { withIcon?: boolean }) => (
  <div className="flex flex-col gap-3.5 px-4 py-3.5" role="status">
    <span className="sr-only">Loading</span>
    {["a", "b", "c", "d"].map((key) => (
      <div className="flex items-center gap-3" key={key}>
        {withIcon ? <Shimmer className="size-7 rounded-[7px]" /> : null}
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-2.5 w-3/5 rounded bg-[#efefec]" />
          <div className="h-[9px] w-[85%] rounded bg-[#f4f4f1]" />
        </div>
      </div>
    ))}
  </div>
);

const runSummary = (run: OrganizationRun) => {
  const { failed, running, total, unknown } = summarizeItems(run.itemCounts);
  if (running > 0) {
    return `${(total - running).toLocaleString()} / ${plural(total, "item")}`;
  }
  return [
    plural(total, "item"),
    failed > 0 ? `${failed.toLocaleString()} failed` : null,
    unknown > 0 ? `${unknown.toLocaleString()} unknown` : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

const backupMeta = (backup: DatabaseBackup) => {
  switch (backup.status) {
    case "RUNNING":
      return `Running · started ${formatRelative(backup.startedAt ?? backup.createdAt)} · ${backup.databaseName}`;
    case "QUEUED":
      return `Queued · ${formatWhen(backup.createdAt)}`;
    case "FAILED":
      return `${backup.error ?? "Failed"} · ${formatWhen(backup.createdAt)}`;
    default:
      return `${formatBytes(backup.sizeBytes)} · ${formatDuration(backup.startedAt, backup.completedAt)} · ${formatWhen(backup.completedAt ?? backup.createdAt)}`;
  }
};

const AttentionSection = ({
  attention,
  isLoading,
}: {
  attention: AttentionItem[];
  isLoading: boolean;
}) => (
  <Section
    action={
      <span className="font-medium text-muted-foreground text-xs">
        {attention.length > 0 ? `${attention.length} open` : "0"}
      </span>
    }
    icon={<BellDot />}
    title="Needs attention"
  >
    {isLoading ? <SkeletonList withIcon /> : null}
    {!isLoading && attention.length === 0 ? (
      <div className="flex flex-col items-center gap-2 px-5 py-9 text-center">
        <div className="grid size-9 place-items-center rounded-full bg-(--status-success-bg) text-(--status-success-fg)">
          <Check className="size-[18px]" />
        </div>
        <div className="font-semibold text-sm">All clear</div>
        <p className="max-w-[300px] text-[13px] text-muted-foreground leading-[1.45]">
          Store health, failed runs, unknown items and backups will surface
          here.
        </p>
      </div>
    ) : null}
    {isLoading
      ? null
      : attention.map((item) => (
          <Link
            className={cn(rowClass, "items-start py-[13px]")}
            href={item.href}
            key={item.key}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-[7px] [&_svg]:size-[15px]",
                ATTENTION_TONES[item.tone]
              )}
            >
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-[13.5px] leading-[1.35]">
                {item.title}
              </span>
              <span className="block text-pretty text-[12.5px] text-muted-foreground leading-[1.45]">
                {item.description}
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap font-medium text-[12.5px] text-accent-ink leading-7">
              {item.cta} →
            </span>
          </Link>
        ))}
  </Section>
);

const StoreHealthSection = ({
  canManage,
  isLoading,
  stores,
}: {
  canManage: boolean;
  isLoading: boolean;
  stores: StoreRecord[];
}) => (
  <Section
    action={<SectionLink href="/stores">All stores</SectionLink>}
    icon={<Store />}
    title="Store health"
  >
    {isLoading ? <SkeletonList /> : null}
    {!isLoading && stores.length === 0 ? (
      <div className="flex flex-col items-center gap-2 px-5 py-9 text-center">
        <div className="grid size-10 place-items-center rounded-[10px] border border-input border-dashed text-muted-foreground">
          <Store className="size-[18px]" />
        </div>
        <div className="font-semibold text-sm">No stores connected</div>
        <p className="max-w-[300px] text-[13px] text-muted-foreground leading-[1.45]">
          Connect a store with an access token, app credentials or OAuth to
          start querying.
        </p>
        {canManage ? (
          <Link
            className={cn(buttonVariants({ size: "sm" }), "mt-1.5")}
            href="/stores/new"
          >
            Connect store
          </Link>
        ) : null}
      </div>
    ) : null}
    {isLoading
      ? null
      : stores.slice(0, 6).map((store) => (
          <Link
            className={cn(rowClass, "py-[11px]")}
            href={`/stores?store=${store.id}`}
            key={store.id}
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-[2px]"
              style={{
                background: `oklch(0.62 0.14 ${hueFromId(store.id)})`,
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-[7px]">
                <span className="truncate font-semibold text-[13.5px] leading-[1.3]">
                  {store.name}
                </span>
                <EnvTag environment={store.environment} />
              </span>
              <span className="block truncate font-mono text-muted-foreground text-xs leading-[1.4]">
                {store.shopDomain}
              </span>
            </span>
            <StatusBadge status={store.status} />
          </Link>
        ))}
  </Section>
);

const RecentRunsSection = ({
  isLoading,
  runs,
}: {
  isLoading: boolean;
  runs: OrganizationRun[];
}) => (
  <Section
    action={<SectionLink href="/flows">All flows</SectionLink>}
    icon={<Activity />}
    title="Recent flow runs"
  >
    {isLoading ? <SkeletonList /> : null}
    {!isLoading && runs.length === 0 ? (
      <p className="px-5 py-8 text-center text-[13px] text-muted-foreground leading-[1.45]">
        No runs yet. Runs appear here once a flow is run against a store.
      </p>
    ) : null}
    {isLoading
      ? null
      : runs.slice(0, 5).map((run) => (
          <Link
            className={cn(
              rowClass,
              "grid grid-cols-[minmax(0,1fr)_120px] gap-x-3.5 gap-y-1.5 py-3"
            )}
            href={`/flows/${run.flowId}/runs/${run.id}`}
            key={run.id}
          >
            <span className="flex min-w-0 items-center gap-2">
              <StatusBadge status={run.status} />
              <span className="truncate font-semibold text-[13.5px] leading-[1.3]">
                {run.flowName}
              </span>
            </span>
            <span className="text-right text-muted-foreground text-xs leading-[22px]">
              {formatRelative(run.createdAt)}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs leading-[1.3]">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-[2px]"
                style={{
                  background: `oklch(0.62 0.14 ${hueFromId(run.storeId)})`,
                }}
              />
              <span className="truncate">
                {run.storeName} · {runSummary(run)}
              </span>
            </span>
            <RunItemsBar className="self-center" counts={run.itemCounts} />
          </Link>
        ))}
  </Section>
);

const RecentBackupsSection = ({
  backups,
  hasConnections,
  isLoading,
}: {
  backups: DatabaseBackup[];
  hasConnections: boolean;
  isLoading: boolean;
}) => (
  <Section
    action={<SectionLink href="/database">All connections</SectionLink>}
    icon={<HardDrive />}
    title="Recent backups"
  >
    {isLoading ? <SkeletonList /> : null}
    {!isLoading && backups.length === 0 ? (
      <p className="px-5 py-8 text-center text-[13px] text-muted-foreground leading-[1.45]">
        {hasConnections ? "No backups yet." : "No database connections yet."}
      </p>
    ) : null}
    {isLoading
      ? null
      : backups.slice(0, 4).map((backup) => (
          <Link
            className={cn(rowClass, "py-3")}
            href={
              backup.connectionId
                ? `/database/${backup.connectionId}`
                : "/database"
            }
            key={backup.id}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-[13.5px] leading-[1.3]">
                {backup.connectionName}
              </span>
              <span className="block truncate text-muted-foreground text-xs leading-[1.4]">
                {backupMeta(backup)}
              </span>
            </span>
            <StatusBadge status={backup.status} />
          </Link>
        ))}
  </Section>
);

/** The five setup steps, each done when the organization's data shows it. */
const onboardingSteps = (input: {
  hasApp: boolean;
  hasFlow: boolean;
  hasStore: boolean;
  organizationName: string;
  ranQuery: boolean;
}): OnboardingStep[] => [
  {
    cta: "Create",
    description: `Everything you connect belongs to ${input.organizationName}.`,
    done: true,
    hint: "Create an organization to hold your stores.",
    href: "/settings",
    title: "Create an organization",
  },
  {
    cta: "Add app",
    description:
      "Add a Shopify app from the Dev Dashboard, or use a custom-app token.",
    done: input.hasApp || input.hasStore,
    hint: "Register a Shopify app, or paste a custom-app token.",
    href: "/stores/apps",
    title: "Register an app or paste a token",
  },
  {
    cta: "Connect store",
    description: "Pick a method — we'll help you choose the right one.",
    done: input.hasStore,
    hint: "Connect a store to start querying and automating.",
    href: "/stores/new",
    title: "Connect your first store",
  },
  {
    cta: "Open console",
    description: "Open the GraphQL console against a connected store.",
    done: input.ranQuery,
    hint: "Run a query to confirm your store connection end-to-end.",
    href: "/graphql",
    title: "Run your first query",
  },
  {
    cta: "New flow",
    description: "Automate per-item work: parse a CSV, find orders, add tags.",
    done: input.hasFlow,
    hint: "Build a flow to automate per-item work.",
    href: "/flows?new=1",
    title: "Build a flow",
  },
];

/** "wizloft has 5 stores, 4 active flows and 3 database connections. …" */
const describeOverview = (input: {
  activeFlows: number | null;
  attention: number;
  connections: number | null;
  organizationName: string;
  stores: number | null;
}) => {
  const parts = [
    input.stores === null ? null : plural(input.stores, "store"),
    input.activeFlows === null
      ? null
      : plural(input.activeFlows, "active flow"),
    input.connections === null
      ? null
      : plural(input.connections, "database connection"),
  ].filter((part): part is string => part !== null);
  const counted =
    parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
      : (parts[0] ?? "");
  const lead = counted ? `${input.organizationName} has ${counted}. ` : "";
  if (input.attention === 0) {
    return `${lead}Nothing needs your attention.`;
  }
  const count =
    input.attention === 1
      ? "1 thing needs"
      : `${COUNT_WORDS[input.attention] ?? input.attention} things need`;
  return `${lead}${count} your attention.`;
};

const OverviewHeader = ({
  can,
  description,
  now,
  userName,
}: {
  can: (permission: Permission) => boolean;
  description: string;
  now: Date | null;
  userName: string;
}) => (
  <PageHeader
    actions={
      <>
        {can("graphql:query") ? (
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/graphql"
          >
            <Braces />
            New query
          </Link>
        ) : null}
        {can("flows:manage") ? (
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/flows?new=1"
          >
            <Workflow />
            New flow
          </Link>
        ) : null}
        {can("stores:manage") ? (
          <Link className={buttonVariants()} href="/stores/new">
            <Plus />
            Connect store
          </Link>
        ) : null}
      </>
    }
    description={description}
    eyebrow={
      now
        ? now.toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            weekday: "long",
          })
        : " "
    }
    title={`${now ? greetingFor(now.getHours()) : "Hello"}, ${userName.split(" ")[0] ?? userName}`}
  />
);

/** Everything the overview reads, limited to what the viewer may see. */
const useOverviewData = (organizationId: string | null) => {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const access = {
    audit: can("audit:read"),
    databases: can("databases:read"),
    flows: can("flows:read"),
    stores: can("stores:read"),
  };
  const stores = useStores(organizationId, access.stores);
  const apps = useShopifyApps(organizationId, access.stores);
  const flows = useFlows(organizationId, access.flows);
  const runs = useOrganizationRuns(organizationId, access.flows);
  const connections = useDatabaseConnections(organizationId, access.databases);
  const backups = useOrganizationBackups(organizationId, access.databases);
  const queried = useQuery({
    enabled: Boolean(organizationId) && access.audit,
    queryFn: async () =>
      (
        await apiClient.organizations.auditLogs({
          actionPrefix: "shopify.graphql.",
          limit: 1,
          organizationId: organizationId ?? "",
        })
      ).data.length > 0,
    queryKey: ["first-query", organizationId],
  });
  const queries = [stores, apps, flows, runs, connections, backups];
  return {
    access,
    apps: apps.data ?? [],
    backups: backups.data ?? [],
    can,
    connections: connections.data ?? [],
    failed: queries.some((query) => query.isError),
    flows: flows.data ?? [],
    isLoading: permissionsLoading || queries.some((query) => query.isLoading),
    queriedInAudit: queried.data === true,
    retry: () => {
      for (const query of queries) {
        query.refetch();
      }
    },
    runs: runs.data ?? [],
    stores: stores.data ?? [],
  };
};

export function DashboardOverview({ userName }: { userName: string }) {
  const { organization } = useActiveOrganization();
  const organizationId = organization?.id ?? null;
  const data = useOverviewData(organizationId);
  const [hidden, setHidden] = useState(true);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    setHidden(
      organizationId ? readFlag(onboardingHiddenKey(organizationId)) : true
    );
  }, [organizationId]);

  if (!organization) {
    return null;
  }

  const attention = attentionItems(data);
  const steps = onboardingSteps({
    hasApp: data.apps.length > 0,
    hasFlow: data.flows.length > 0,
    hasStore: data.stores.length > 0,
    organizationName: organization.name,
    ranQuery: data.queriedInAudit || readFlag(firstQueryKey(organization.id)),
  });
  const showChecklist =
    !(hidden || data.isLoading) && steps.some(({ done }) => !done);
  const description = describeOverview({
    activeFlows: data.access.flows
      ? data.flows.filter(({ status }) => status === "ACTIVE").length
      : null,
    attention: attention.length,
    connections: data.access.databases ? data.connections.length : null,
    organizationName: organization.name,
    stores: data.access.stores ? data.stores.length : null,
  });

  return (
    <>
      <OverviewHeader
        can={data.can}
        description={data.isLoading ? " " : description}
        now={now}
        userName={userName}
      />

      {data.failed ? (
        <ErrorAlert
          message="Some of the overview may be out of date."
          onRetry={data.retry}
          title="Couldn't load the overview."
        />
      ) : null}

      {showChecklist ? (
        <OnboardingChecklist
          onDismiss={() => {
            writeFlag(onboardingHiddenKey(organization.id), true);
            setHidden(true);
          }}
          organizationName={organization.name}
          steps={steps}
        />
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-[18px]">
        <AttentionSection attention={attention} isLoading={data.isLoading} />
        {data.access.stores ? (
          <StoreHealthSection
            canManage={data.can("stores:manage")}
            isLoading={data.isLoading}
            stores={data.stores}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-[18px]">
        {data.access.flows ? (
          <RecentRunsSection isLoading={data.isLoading} runs={data.runs} />
        ) : null}
        {data.access.databases ? (
          <RecentBackupsSection
            backups={data.backups}
            hasConnections={data.connections.length > 0}
            isLoading={data.isLoading}
          />
        ) : null}
      </div>
    </>
  );
}
