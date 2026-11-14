"use client";
import {
  Button,
  Database,
  PageHeader,
  Plus,
  RefreshCw,
} from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
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
  overview: "OMS management",
  tools: "Management tools",
};
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
      <div className="mx-auto max-w-lg p-8">
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
  return (
    <section className="space-y-6 p-6 lg:p-8">
      <div className="text-muted-foreground text-sm">
        <Link href="/works">Works</Link>
        <span className="mx-2">/</span>
        <Link href={MANAGEMENT_ROOT}>OMS management</Link>
        {settings && (
          <>
            <span className="mx-2">/</span>Settings
            <span className="mx-2">/</span>Site config
          </>
        )}
      </div>
      <PageHeader
        description={
          profile
            ? profile.databaseLabel
            : "Choose an OMS connection to inspect logs and manage site configuration."
        }
        title={SECTION_TITLES[section]}
      />
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <Database className="size-4 text-muted-foreground" />
        <Select
          items={(catalog.data?.profiles ?? [])
            .filter((p) => p.enabled)
            .map((p) => ({ label: p.name, value: p.id }))}
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
          <SelectTrigger aria-label="Environment" className="w-56">
            <SelectValue placeholder="Select environment" />
          </SelectTrigger>
          <SelectContent>
            {catalog.data?.profiles
              .filter((p) => p.enabled)
              .map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {profile && (
          <Badge
            variant={
              profile.safetyClass === "production" ? "destructive" : "secondary"
            }
          >
            {profile.safetyClass} · revision {profile.revision}
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => setEditing("new")} variant="outline">
            <Plus className="size-4" />
            Add connection
          </Button>
          {profile?.capabilities.includes("profiles:edit") && (
            <Button onClick={() => setEditing(profile)} variant="outline">
              Connection settings
            </Button>
          )}
          <Button
            aria-label="Refresh OMS data"
            disabled={dirty}
            onClick={() => client.invalidateQueries()}
            title={
              dirty
                ? "Save or discard changes before refreshing"
                : "Refresh OMS data"
            }
            variant="outline"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>
      <nav
        aria-label="OMS management"
        className="flex gap-2 border-border border-b pb-3"
      >
        {(
          [
            ["overview", "Overview"],
            ["logs", "Debug logs"],
            ["maintenance", "Settings"],
          ] as const
        ).map(([id, label]) => (
          <Button
            aria-current={
              section === id || (id === "maintenance" && settings)
                ? "page"
                : undefined
            }
            key={id}
            onClick={() => navigate(id)}
            variant={
              section === id || (id === "maintenance" && settings)
                ? "secondary"
                : "ghost"
            }
          >
            {label}
          </Button>
        ))}
      </nav>
      {settings && (
        <nav aria-label="Site config" className="flex flex-wrap gap-2">
          {(
            [
              ["maintenance", "Site configuration"],
              ["cron", "Scheduled jobs"],
              ["tools", "Management tools"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              onClick={() => navigate(id)}
              variant={section === id ? "secondary" : "ghost"}
            >
              {label}
            </Button>
          ))}
        </nav>
      )}
      {profile?.safetyClass === "production" && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
          role="status"
        >
          <strong>Production environment.</strong> All data and operations
          belong to production.
        </div>
      )}
      <ManagementView
        actor={catalog.data?.actor}
        error={catalog.error}
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
    </section>
  );
}

export { queryKey } from "../lib/contracts";

function ManagementView({
  actor,
  profiles,
  profile,
  section,
  pending,
  error,
  setDirty,
  onSelect,
}: {
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
      <div key={`${actor.id}:${profile.id}:${profile.revision}:${section}`}>
        {content}
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {profiles
        .filter((p) => p.enabled)
        .map((p) => (
          <Button
            className="h-auto flex-col items-start rounded-xl p-5 text-left"
            key={p.id}
            onClick={() => onSelect(p.id)}
            variant="outline"
          >
            <span className="font-semibold">{p.name}</span>
            <span className="mt-2 text-muted-foreground text-sm">
              {p.databaseLabel}
            </span>
            <Badge className="mt-3" variant="secondary">
              {p.safetyClass}
            </Badge>
          </Button>
        ))}
      {profiles.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-muted-foreground text-sm">
          No OMS connections configured yet. Add a connection or configure the
          staging and production presets.
        </div>
      )}
    </div>
  );
}
