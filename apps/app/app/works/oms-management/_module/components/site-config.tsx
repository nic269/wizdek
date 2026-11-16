"use client";
import { Button, RefreshCw } from "@repo/design-system";
import {
  Alert,
  AlertDescription,
} from "@repo/design-system/components/ui/alert";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { type Actor, type PublicProfile, queryKey } from "../lib/contracts";
import { mergeCronJobs, type SiteConfigData } from "../lib/site-config";
import { CronControls } from "./cron-controls";
import { request } from "./management-app";
import { ErrorNotice, Panel } from "./oms-ui";
import { MaintenanceEditor, OperationHistory } from "./operation-controls";
import {
  GeneralSiteSettings,
  ShopifyAppsSettings,
} from "./shopify-app-settings";

export function SiteConfig({
  profile,
  actor,
  setDirty,
  cronOnly = false,
}: {
  profile: PublicProfile;
  actor: Actor;
  setDirty: (dirty: boolean) => void;
  cronOnly?: boolean;
}) {
  const dirtySections = useRef(new Set<string>());
  const queryClient = useQueryClient();
  const [hasDirtySections, setLocalDirty] = useState(false);
  function sectionDirty(section: string, dirty: boolean) {
    if (dirty) {
      queryClient
        .cancelQueries({
          queryKey: queryKey(
            actor.id,
            { profileId: profile.id, revision: profile.revision },
            "global",
            "site-config"
          ),
        })
        .catch(() => undefined);
      dirtySections.current.add(section);
    } else {
      dirtySections.current.delete(section);
    }
    const hasChanges = dirtySections.current.size > 0;
    setLocalDirty(hasChanges);
    setDirty(hasChanges);
  }
  const target = { profileId: profile.id, revision: profile.revision };
  const query = useQuery({
    enabled: !hasDirtySections,
    queryFn: ({ signal }) =>
      request<{ target: typeof target; data: SiteConfigData }>(
        `site-config?${new URLSearchParams({ profileId: profile.id, revision: String(profile.revision) })}`,
        { signal }
      ),
    queryKey: queryKey(actor.id, target, "global", "site-config"),
    refetchOnWindowFocus: false,
  });
  const data =
    query.data?.target.profileId === profile.id &&
    query.data.target.revision === profile.revision
      ? query.data.data
      : null;
  if (query.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (query.error) {
    return (
      <Panel title="Unable to load Site config">
        <ErrorNotice message={query.error.message} />
        <Button
          className="mt-3"
          onClick={() => query.refetch()}
          variant="outline"
        >
          Try again
        </Button>
      </Panel>
    );
  }
  if (!data) {
    return null;
  }
  const cronJobs = data.cron ? mergeCronJobs(data.cron) : [];
  return (
    <div className="space-y-6">
      {profile.hasApi ? null : (
        <Alert>
          <AlertDescription>
            Settings are read and saved directly in the selected database. Add
            the OMS API connection only to run scheduled jobs immediately.
          </AlertDescription>
        </Alert>
      )}
      {!cronOnly && (
        <>
          <div className="grid items-start gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
            {data.maintenance ? (
              <MaintenanceEditor
                data={data.maintenance}
                key={data.maintenance.version ?? "initial"}
                profile={profile}
                setDirty={(dirty) => sectionDirty("maintenance", dirty)}
              />
            ) : (
              <ErrorNotice message="Maintenance settings are unavailable with this database's schema or permissions." />
            )}
            <OperationHistory profile={profile} />
          </div>
          {!!data.maintenance && (
            <GeneralSiteSettings
              key={data.settingsVersion}
              profile={profile}
              setDirty={(dirty) => sectionDirty("general", dirty)}
              settings={data.settings}
              version={data.settingsVersion}
            />
          )}
          <ShopifyAppsSettings
            apiVersion={data.settings.shopifyApiVersion}
            apps={data.apps}
            available={data.appsAvailable}
            profile={profile}
            requiredScopes={data.settings.shopifyRequiredScopes}
            setDirty={(dirty) => sectionDirty("apps", dirty)}
          />
        </>
      )}
      <div
        className={
          cronOnly
            ? "grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]"
            : undefined
        }
      >
        <Panel
          action={
            <Button
              disabled={query.isFetching || dirtySections.current.size > 0}
              onClick={() => query.refetch()}
              size="sm"
              variant="outline"
            >
              <RefreshCw className={query.isFetching ? "animate-spin" : ""} />
              Refresh
            </Button>
          }
          bodyClassName="px-0"
          description={`Schedules use ${data.cron?.timeZone ?? data.settings.siteTimezone}. Changes are loaded dynamically and do not require a restart.`}
          title="Cron jobs"
        >
          {data.cron ? (
            <div className="-my-4">
              {cronJobs.map((job) => (
                <CronControls
                  job={job}
                  key={`${String(job.jobKey ?? job.key)}:${String(job.updatedAt ?? "initial")}`}
                  profile={profile}
                  setDirty={(dirty) =>
                    sectionDirty(`cron:${String(job.jobKey ?? job.key)}`, dirty)
                  }
                  timeZone={data.cron?.timeZone ?? data.settings.siteTimezone}
                />
              ))}
              {!cronJobs.length && (
                <p className="py-6 text-center text-muted-foreground text-sm">
                  No cronjobs are registered.
                </p>
              )}
            </div>
          ) : (
            <ErrorNotice message="Cronjobs are unavailable with this database's schema or permissions." />
          )}
        </Panel>
        {cronOnly ? <CronSyntaxHelp /> : null}
      </div>
      {cronOnly ? <OperationHistory profile={profile} /> : null}
    </div>
  );
}

/** The five cron fields and the common operators, beside the job list. */
function CronSyntaxHelp() {
  return (
    <aside
      aria-label="Cron syntax help"
      className="flex flex-col gap-3 rounded-card bg-sunken p-4 shadow-[inset_0_0_0_1px_var(--border)]"
    >
      <h3 className="font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
        Cron syntax
      </h3>
      <pre className="font-mono text-[12px] text-foreground-2 leading-[22px] tracking-[-0.01em]">
        {`┌ minute      0–59
│ ┌ hour      0–23
│ │ ┌ day     1–31
│ │ │ ┌ month 1–12
│ │ │ │ ┌ weekday 0–6
* * * * *`}
      </pre>
      <div className="h-px bg-border" />
      <dl className="flex flex-col gap-1.5 text-[12.5px]">
        {(
          [
            ["*/5", "every 5 units"],
            ["1-5", "range"],
            ["0,30", "list"],
          ] as const
        ).map(([syntax, meaning]) => (
          <div className="flex items-center gap-2" key={syntax}>
            <dt className="w-[90px] font-mono text-[12px] tracking-[-0.01em]">
              {syntax}
            </dt>
            <dd className="text-muted-foreground">{meaning}</dd>
          </div>
        ))}
      </dl>
      <div className="h-px bg-border" />
      <p className="text-muted-foreground text-xs">
        Run immediately queues the job once and records an operation. On
        production it asks for confirmation.
      </p>
    </aside>
  );
}
