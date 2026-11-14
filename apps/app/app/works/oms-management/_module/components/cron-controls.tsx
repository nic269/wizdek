"use client";
import { Input } from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
import Link from "next/link";
import { useState } from "react";
import type { PublicProfile } from "../lib/contracts";
import { managementHref } from "../lib/navigation";
import { formatSiteDate } from "../lib/site-config";
import { FormField } from "./oms-ui";
import { OperationButton } from "./operation-controls";

const CRON_SEPARATOR = /\s+/;

export function CronControls({
  profile,
  job,
  setDirty,
  timeZone = "UTC",
}: {
  profile: PublicProfile;
  job: Record<string, unknown>;
  setDirty: (value: boolean) => void;
  timeZone?: string;
}) {
  const originalExpression = String(
    job.cronExpression ?? job.defaultCronExpression ?? ""
  );
  const [expression, setExpression] = useState(originalExpression);
  const version = job.updatedAt ? String(job.updatedAt) : null;
  const jobKey = String(job.jobKey ?? job.key);
  const enabled = job.enabled !== false;
  const scheduledRun = job.nextRunAt
    ? formatSiteDate(job.nextRunAt, timeZone)
    : "Unavailable";
  const lastRun = job.lastRun as Record<string, unknown> | null;
  const logHref = `${managementHref("logs", profile.id)}&featureKey=${encodeURIComponent(`scheduled-job.${jobKey}`)}`;
  return (
    <div className="rounded-card p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">
              {String(job.title ?? jobKey)}
            </h3>
            <Badge variant={enabled ? "secondary" : "outline"}>
              {enabled ? "Running" : "Stopped"}
            </Badge>
            {job.module ? (
              <Badge variant="outline">{String(job.module)}</Badge>
            ) : null}
          </div>
          {job.description ? (
            <p className="mt-1 text-muted-foreground text-sm">
              {String(job.description)}
            </p>
          ) : null}
          <p className="mt-1 text-muted-foreground text-xs tabular-nums">
            {jobKey}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OperationButton
            action="cron.run-now"
            expectedVersion={version}
            label="Run immediately"
            payload={{ jobKey }}
            profile={profile}
          />
          <OperationButton
            action={enabled ? "cron.stop" : "cron.start"}
            expectedVersion={version}
            label={enabled ? "Stop" : "Start"}
            payload={{ jobKey }}
            profile={profile}
          />
        </div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <FormField
            description="Minute Hour Day-of-month Month Day-of-week. Example: 0 9 * * * runs daily at 09:00."
            id={`cron-${jobKey}`}
            label="Schedule (5-field cron expression)"
          >
            <div className="flex gap-2">
              <Input
                className="font-mono"
                id={`cron-${jobKey}`}
                onChange={(event) => {
                  setExpression(event.target.value);
                  setDirty(event.target.value !== originalExpression);
                }}
                placeholder="0 9 * * *"
                value={expression}
              />
              <OperationButton
                action="cron.update"
                disabled={
                  expression === originalExpression ||
                  expression.trim().split(CRON_SEPARATOR).length !== 5
                }
                expectedVersion={version}
                label="Save"
                onComplete={() => setDirty(false)}
                payload={{ cronExpression: expression, enabled, jobKey }}
                profile={profile}
              />
            </div>
          </FormField>
        </div>
        <div className="space-y-2 rounded-lg bg-sunken p-4 text-sm">
          <p className="font-medium">
            Next run: {enabled ? scheduledRun : "Stopped"}
          </p>
          <p className="text-muted-foreground">
            Last checked: {formatSiteDate(job.lastCheckedAt, timeZone)}
          </p>
          <p className="text-muted-foreground">
            Last activity: {formatSiteDate(job.lastActivityAt, timeZone)}
          </p>
          <p className="text-muted-foreground">
            Last success: {formatSiteDate(job.lastSuccessAt, timeZone)}
          </p>
          <p className="text-muted-foreground">
            Last failure: {formatSiteDate(job.lastFailureAt, timeZone)}
          </p>
          <p className="text-muted-foreground">
            Last run:{" "}
            {lastRun
              ? `${String(lastRun.status)} · ${formatSiteDate(lastRun.startedAt, timeZone)}`
              : "Never"}
          </p>
          {Number(job.consecutiveFailures) > 0 ? (
            <p className="text-destructive">
              Consecutive failures: {String(job.consecutiveFailures)}
            </p>
          ) : null}
          {lastRun?.errorMessage ? (
            <p className="break-words text-destructive">
              {String(lastRun.errorMessage)}
            </p>
          ) : null}
          <Link
            className="inline-flex font-medium text-primary underline-offset-4 hover:underline"
            href={logHref}
          >
            View Debug Logs
          </Link>
        </div>
      </div>
    </div>
  );
}
