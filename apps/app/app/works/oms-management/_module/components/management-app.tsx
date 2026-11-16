"use client";
import {
  Button,
  EmptyState,
  EnvTag,
  NavTabs,
  PageHeader,
  Plus,
  RefreshCw,
  ShellHeader,
  SlidersHorizontal,
  StatusBadge,
  Warehouse,
} from "@repo/design-system";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import type { Actor, PublicProfile } from "../lib/contracts";
import {
  MANAGEMENT_ROOT,
  type ManagementSection,
  managementHref,
} from "../lib/navigation";
import { BusinessTools } from "./business-tools";
import { ConnectionEditor } from "./connection-editor";
import { Diagnostics } from "./diagnostics";
import { SiteConfig } from "./site-config";

const SECTION_TITLES: Record<ManagementSection, string> = {
  cron: "Scheduled jobs",
  logs: "Debug logs",
  maintenance: "Site config",
  overview: "Diagnostics",
  tools: "Management tools",
};

const ShellLink = ({
  children,
  className,
  href,
}: {
  children: React.ReactNode;
  className?: string;
  href: string;
}) => (
  <Link className={className} href={href}>
    {children}
  </Link>
);
/** Logs fill the panel edge to edge; every other section is a padded page. */
const bodyLayout = (
  fullWidth: boolean,
  settings: boolean,
  hasConnections: boolean
) =>
  fullWidth
    ? { className: "flex min-h-0 flex-1 flex-col", heading: false }
    : {
        className:
          "flex min-h-0 flex-1 flex-col gap-6 pt-6 pb-12 pr-4 pl-5 sm:pt-7",
        heading: hasConnections && !settings,
      };

const connectionsAssumed = (
  pending: boolean,
  error: Error | null,
  count: number | undefined
) => pending || Boolean(error) || (count ?? 0) > 0;

function confirmDiscard(message: string) {
  const ask = window.confirm;
  return ask(message);
}
export async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${MANAGEMENT_ROOT}/api/${path}`, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options?.method
        ? { "content-type": "application/json", "x-oms-action": "1" }
        : {}),
      ...options?.headers,
    },
  });
  const data = await response.json();
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("oms-session-expired"));
  }
  if (!response.ok) {
    throw new Error(
      data.error?.message ?? "The request could not be completed."
    );
  }
  return data;
}
export function ManagementApp({
  profileId,
  section = "overview",
}: {
  profileId?: string | undefined;
  section?: ManagementSection;
}) {
  // Keep target data isolated from the rest of Wizdek's query cache.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: 0,
            refetchOnWindowFocus: true,
            retry: false,
            staleTime: 0,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <ManagementContent
        client={client}
        profileId={profileId}
        section={section}
      />
    </QueryClientProvider>
  );
}
function ManagementContent({
  client,
  profileId,
  section,
}: {
  client: QueryClient;
  profileId?: string | undefined;
  section: ManagementSection;
}) {
  const router = useRouter();
  const [expired, setExpired] = useState(false);
  const [editing, setEditing] = useState<PublicProfile | "new" | null>(null);
  const [dirty, setDirty] = useState(false);
  const catalog = useQuery({
    queryFn: ({ signal }) =>
      request<{ actor: Actor; profiles: PublicProfile[] }>("profiles", {
        signal,
      }),
    queryKey: ["oms-catalog"],
  });
  const profile = catalog.data?.profiles.find((p) => p.id === profileId);
  useEffect(() => {
    let active = true;
    const expire = () => {
      setExpired(true);
      client.clear();
    };
    window.addEventListener("oms-session-expired", expire);
    const renew = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      try {
        const response = await fetch("/api/identity", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const identity = response.ok ? await response.json() : null;
        if (
          active &&
          (!identity ||
            (catalog.data?.actor.id &&
              identity.user.id !== catalog.data.actor.id))
        ) {
          setExpired(true);
          client.clear();
        }
      } catch {
        if (active) {
          setExpired(true);
          client.clear();
        }
      }
    };
    renew();
    const timer = setInterval(renew, 600_000);
    window.addEventListener("focus", renew);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", renew);
      window.removeEventListener("oms-session-expired", expire);
    };
  }, [client, catalog.data?.actor.id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    // Protect unsaved forms when leaving through the shared Wizdek navigation.
    const intercept = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (dirty && anchor && !confirmDiscard("Discard unsaved OMS changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", intercept, true);
    };
  }, [dirty]);
  async function navigate(
    next: ManagementSection,
    id = profileId,
    confirmed = false
  ) {
    if (!confirmed && dirty && !confirmDiscard("Discard unsaved changes?")) {
      return;
    }
    await client.cancelQueries();
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== "oms-catalog" });
    setEditing(null);
    setDirty(false);
    router.push(managementHref(next, id));
  }
  if (expired) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-8">
        <PageHeader
          description="Your Wizdek session could not be verified."
          title="Sign in to continue"
        />
        <Button
          nativeButton={false}
          render={
            <Link
              href={`/sign-in?callbackUrl=${encodeURIComponent(managementHref(section, profileId))}`}
            />
          }
        >
          Continue with Wizdek
        </Button>
      </div>
    );
  }
  const settings = ["maintenance", "cron", "tools"].includes(section);
  const production = profile?.safetyClass === "production";
  let shellRisk: "production" | "staging" | undefined;
  if (production) {
    shellRisk = "production";
  } else if (profile) {
    shellRisk = "staging";
  }
  const enabledProfiles = (catalog.data?.profiles ?? []).filter(
    (p) => p.enabled
  );
  // Until the catalog loads, assume connections exist so the header is stable.
  const hasConnections = connectionsAssumed(
    catalog.isPending,
    catalog.error,
    catalog.data?.profiles.length
  );
  const layout = bodyLayout(
    section === "logs" && Boolean(profile),
    settings,
    hasConnections
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <ShellHeader
        actions={
          <HeaderActions
            canAdd={hasConnections}
            dirty={dirty}
            onAdd={() => setEditing("new")}
            onEdit={setEditing}
            onRefresh={() => client.invalidateQueries()}
            profile={profile}
          />
        }
        context={
          <Select
            items={enabledProfiles.map((p) => ({ label: p.name, value: p.id }))}
            onValueChange={(id, details) => {
              if (dirty && !confirmDiscard("Discard unsaved changes?")) {
                details.cancel();
                return;
              }
              if (id) {
                navigate(section, id, true);
              }
            }}
            value={profileId ?? ""}
          >
            <SelectTrigger
              aria-label="Environment"
              className={
                production
                  ? "h-[30px] min-w-48 gap-2 rounded-lg border-0 bg-card text-[12.5px] shadow-[0_0_0_1px_var(--prod-line),0_0_0_3px_rgba(201,58,44,0.08)]"
                  : "h-[30px] min-w-48 gap-2 rounded-lg border-0 bg-card text-[12.5px] shadow-[0_0_0_1px_var(--input)]"
              }
              size="sm"
            >
              {profile ? (
                <EnvTag environment={production ? "PROD" : "STAGING"} />
              ) : null}
              <SelectValue placeholder="Select environment" />
            </SelectTrigger>
            <SelectContent>
              {enabledProfiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        crumbs={[
          { href: "/works/oms-management", label: "Works" },
          ...(section === "overview"
            ? [{ label: "OMS management" }]
            : [
                { href: MANAGEMENT_ROOT, label: "OMS management" },
                { label: settings ? "Site config" : SECTION_TITLES[section] },
              ]),
        ]}
        lead={
          <>
            <span aria-hidden="true" className="h-5 w-px bg-border" />
            <NavTabs
              aria-label="OMS sections"
              tabs={(
                [
                  ["overview", "Overview"],
                  ["logs", "Debug logs"],
                  ["maintenance", "Site config"],
                ] as const
              ).map(([id, label]) => ({
                current: section === id || (id === "maintenance" && settings),
                key: id,
                label,
                onSelect: () => navigate(id),
              }))}
              variant="header"
            />
          </>
        }
        linkComponent={ShellLink}
        productionNote={
          <>
            <strong>Production environment.</strong> All data and operations
            belong to production.
          </>
        }
        risk={shellRisk}
      />
      <div className={layout.className}>
        {layout.heading ? (
          <SectionHeading
            actor={catalog.data?.actor}
            profile={profile}
            title={SECTION_TITLES[section]}
          />
        ) : null}
        {settings && (
          <NavTabs
            aria-label="Site config"
            tabs={(
              [
                ["maintenance", "Maintenance"],
                ["cron", "Cron jobs"],
                ["tools", "Tools"],
              ] as const
            ).map(([id, label]) => ({
              current: section === id,
              key: id,
              label,
              onSelect: () => navigate(id),
            }))}
            variant="segmented"
          />
        )}
        <ManagementView
          actor={catalog.data?.actor}
          error={catalog.error}
          onAdd={() => setEditing("new")}
          onSelect={(id) => navigate(section, id)}
          pending={catalog.isPending}
          profile={profile}
          profiles={catalog.data?.profiles ?? []}
          section={section}
          setDirty={setDirty}
        />
        {editing !== null && (
          <ConnectionEditor
            onClose={() => {
              setEditing(null);
              setDirty(false);
            }}
            onDirty={() => setDirty(true)}
            onSaved={async (savedProfileId) => {
              setDirty(false);
              setEditing(null);
              await catalog.refetch();
              if (savedProfileId) {
                navigate("overview", savedProfileId, true);
              }
            }}
            profile={editing === "new" ? null : editing}
          />
        )}
      </div>
    </section>
  );
}

export { queryKey } from "../lib/contracts";

/** The header buttons: add a connection, edit the current one, refresh. */
function HeaderActions({
  canAdd,
  dirty,
  onAdd,
  onEdit,
  onRefresh,
  profile,
}: {
  canAdd: boolean;
  dirty: boolean;
  onAdd: () => void;
  onEdit: (profile: PublicProfile) => void;
  onRefresh: () => void;
  profile: PublicProfile | undefined;
}) {
  return (
    <>
      {canAdd ? (
        <Button onClick={onAdd} size="sm" variant="outline">
          <Plus className="size-4" />
          Add connection
        </Button>
      ) : null}
      {profile?.capabilities.includes("profiles:edit") ? (
        <Button
          aria-label="Connection settings"
          onClick={() => onEdit(profile)}
          size="icon-sm"
          title="Connection settings"
          variant="outline"
        >
          <SlidersHorizontal className="size-4" />
        </Button>
      ) : null}
      <Button
        aria-label="Refresh OMS data"
        disabled={dirty}
        onClick={onRefresh}
        size="icon-sm"
        title={
          dirty
            ? "Save or discard changes before refreshing"
            : "Refresh OMS data"
        }
        variant="ghost"
      >
        <RefreshCw className="size-4" />
      </Button>
    </>
  );
}

/** The page title with the connection line and the verified-session badge. */
function SectionHeading({
  actor,
  profile,
  title,
}: {
  actor: Actor | undefined;
  profile: PublicProfile | undefined;
  title: string;
}) {
  if (!profile) {
    return (
      <PageHeader
        description="Choose an OMS connection to inspect logs and manage site configuration."
        title={title}
      />
    );
  }
  return (
    <PageHeader
      aside={
        actor ? (
          <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <StatusBadge tone="success">Session verified</StatusBadge>
            <span className="tabular-nums">{actor.email}</span>
          </span>
        ) : undefined
      }
      description={`${profile.name} · ${profile.databaseLabel} · revision ${profile.revision}`}
      title={title}
    />
  );
}

function ManagementView({
  actor,
  profiles,
  profile,
  section,
  pending,
  error,
  setDirty,
  onAdd,
  onSelect,
}: {
  onAdd: () => void;
  actor: Actor | undefined;
  profiles: PublicProfile[];
  profile: PublicProfile | undefined;
  section: ManagementSection;
  pending: boolean;
  error: Error | null;
  setDirty: (dirty: boolean) => void;
  onSelect: (id: string) => Promise<void>;
}) {
  if (pending) {
    return (
      <p className="text-muted-foreground" role="status">
        Verifying access…
      </p>
    );
  }
  if (error) {
    return (
      <p
        className="rounded-lg border border-destructive/30 p-4 text-destructive"
        role="alert"
      >
        {error.message}
      </p>
    );
  }
  if (profile && actor) {
    let content = (
      <Diagnostics actor={actor} profile={profile} section={section} />
    );
    if (section === "tools") {
      content = <BusinessTools profile={profile} setDirty={setDirty} />;
    } else if (section === "maintenance" || section === "cron") {
      content = (
        <SiteConfig
          actor={actor}
          cronOnly={section === "cron"}
          profile={profile}
          setDirty={setDirty}
        />
      );
    }
    return (
      <div
        className={section === "logs" ? "flex min-h-0 flex-1 flex-col" : ""}
        key={`${actor.id}:${profile.id}:${profile.revision}:${section}`}
      >
        {content}
      </div>
    );
  }
  if (profiles.length === 0) {
    return (
      <EmptyState
        action={
          <Button onClick={onAdd} type="button">
            <Plus className="size-4" />
            Add connection
          </Button>
        }
        className="m-auto max-w-[520px] gap-3.5"
        description="Add a staging environment first. Production can be added once staging is verified — it gets typed confirmations on every change."
        icon={<Warehouse />}
        title="Connect an OMS environment"
      />
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {profiles
        .filter((p) => p.enabled)
        .map((p) => (
          <Button
            className="h-auto flex-col items-start gap-1 rounded-card p-4 text-left"
            key={p.id}
            onClick={() => onSelect(p.id)}
            variant="outline"
          >
            <span className="font-semibold">{p.name}</span>
            <span className="mt-2 text-muted-foreground text-sm">
              {p.databaseLabel}
            </span>
            <EnvTag
              className="mt-2"
              environment={p.safetyClass === "production" ? "PROD" : "STAGING"}
            />
          </Button>
        ))}
    </div>
  );
}
