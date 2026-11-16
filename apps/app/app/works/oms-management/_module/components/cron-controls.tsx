"use client";
import { Input, StatusBadge } from "@repo/design-system";
import Link from "next/link";
import { useState } from "react";
import type { PublicProfile } from "../lib/contracts";
import { managementHref } from "../lib/navigation";
import { formatSiteDate } from "../lib/site-config";
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
  const changed = expression !== originalExpression;
  const lastRunFailed =
    String(lastRun?.status ?? "").toUpperCase() === "FAILED";
  return (
    <div className="border-border border-b px-4 py-3.5 last:border-b-0">
      <div className="grid items-start gap-x-4 gap-y-3 xl:grid-cols-[minmax(0,1.3fr)_170px_minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-[550] text-[13px]">
              {String(job.title ?? jobKey)}
            </h3>
            <StatusBadge tone={enabled ? "success" : "neutral"}>
              {enabled ? "Running" : "Stopped"}
            </StatusBadge>
          </div>
          {job.description ? (
            <p className="text-muted-foreground text-xs">
              {String(job.description)}
            </p>
          ) : null}
          <p className="font-mono text-[11.5px] text-faint tracking-[-0.01em]">
            {jobKey}
            {job.module ? ` · ${String(job.module)}` : ""}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <Input
              aria-label="Schedule (5-field cron expression)"
              className="font-mono"
              id={`cron-${jobKey}`}
              onChange={(event) => {
                setExpression(event.target.value);
                setDirty(event.target.value !== originalExpression);
              }}
              placeholder="0 9 * * *"
              value={expression}
            />
            {changed ? (
              <OperationButton
                action="cron.update"
                disabled={expression.trim().split(CRON_SEPARATOR).length !== 5}
                expectedVersion={version}
                label="Save"
                onComplete={() => setDirty(false)}
                payload={{ cronExpression: expression, enabled, jobKey }}
                profile={profile}
              />
            ) : null}
          </div>
          <span className="text-[11px] text-faint">
            min hour day month weekday
          </span>
        </div>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 pt-1.5 text-xs tabular-nums">
          <dt className="text-faint">Next run</dt>
          <dd>{enabled ? scheduledRun : "Stopped"}</dd>
          <dt className="text-faint">Last run</dt>
          <dd className={lastRunFailed ? "text-(--status-danger-fg)" : ""}>
            {lastRun
              ? `${String(lastRun.status)} · ${formatSiteDate(lastRun.startedAt, timeZone)}`
              : "Never"}
          </dd>
        </dl>
        <div className="flex gap-2 xl:justify-end">
          <OperationButton
            action="cron.run-now"
            expectedVersion={version}
            label="Run immediately"
            payload={{ jobKey }}
            profile={profile}
            variant="outline"
          />
          <OperationButton
            action={enabled ? "cron.stop" : "cron.start"}
            expectedVersion={version}
            label={enabled ? "Stop" : "Start"}
            payload={{ jobKey }}
            profile={profile}
            variant="outline"
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs tabular-nums">
        <span>Checked {formatSiteDate(job.lastCheckedAt, timeZone)}</span>
        <span>Success {formatSiteDate(job.lastSuccessAt, timeZone)}</span>
        <span>Failure {formatSiteDate(job.lastFailureAt, timeZone)}</span>
        {Number(job.consecutiveFailures) > 0 ? (
          <span className="text-(--status-danger-fg)">
            Consecutive failures: {String(job.consecutiveFailures)}
          </span>
        ) : null}
        <span className="flex-1" />
        <Link
          className="font-medium text-accent-ink hover:text-accent"
          href={logHref}
        >
          View Debug Logs
        </Link>
      </div>
      {lastRun?.errorMessage ? (
        <p className="mt-1 break-words text-(--status-danger-fg) text-xs">
          {String(lastRun.errorMessage)}
        </p>
      ) : null}
    </div>
  );
}
