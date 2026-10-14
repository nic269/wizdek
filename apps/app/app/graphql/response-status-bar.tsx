"use client";

import { cn } from "@repo/design-system";
import type { ExecutionOutcome } from "./use-console-fetcher";

type Tone = "default" | "bad" | "good" | "muted";

const TONES: Record<Tone, string> = {
  bad: "text-(--status-danger-fg)",
  default: "text-foreground",
  good: "text-(--status-success-fg)",
  muted: "text-muted-foreground",
};

function Item({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: Tone;
  value: string | number;
}) {
  return (
    <span className="inline-flex items-center gap-[5px] whitespace-nowrap">
      <span>{label}</span>
      <span
        className={cn(
          "font-medium font-mono text-[11.5px] leading-none",
          TONES[tone]
        )}
      >
        {value}
      </span>
    </span>
  );
}

const countTone = (count: number): Tone => (count > 0 ? "bad" : "default");

const Bar = ({ children }: { children: React.ReactNode }) => (
  <div
    className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-border border-t bg-card px-3 py-2 text-[11.5px] text-muted-foreground leading-[1.4]"
    data-testid="response-status-bar"
  >
    {children}
  </div>
);

/** Summarises the last execution: status, error counts, cost and throttle. */
export function ResponseStatusBar({
  apiVersion,
  outcome,
  running,
  shopDomain,
}: {
  apiVersion: string;
  outcome: ExecutionOutcome | null;
  running: boolean;
  shopDomain: string;
}) {
  if (running || !outcome) {
    return (
      <Bar>
        <Item
          label={running ? "Running against" : "Ready ·"}
          value={shopDomain}
        />
        <Item label="API" value={apiVersion} />
      </Bar>
    );
  }

  if (outcome.kind === "refused") {
    return (
      <Bar>
        <span className="text-(--status-danger-fg)">
          Not sent to Shopify: {outcome.message}
        </span>
      </Bar>
    );
  }

  const {
    cost,
    graphqlErrorCount,
    httpStatus,
    shopifyRequestId,
    userErrorCount,
  } = outcome.result;
  const throttle = cost?.throttleStatus;
  const costs = [
    cost?.requestedQueryCost === undefined
      ? null
      : `${cost.requestedQueryCost} req`,
    cost?.actualQueryCost === undefined
      ? null
      : `${cost.actualQueryCost} actual`,
  ].filter(Boolean);

  return (
    <Bar>
      <Item
        label="HTTP"
        tone={httpStatus >= 200 && httpStatus < 300 ? "good" : "bad"}
        value={httpStatus}
      />
      <Item
        label="GraphQL errors"
        tone={countTone(graphqlErrorCount)}
        value={graphqlErrorCount}
      />
      <Item
        label="User errors"
        tone={countTone(userErrorCount)}
        value={userErrorCount}
      />
      {costs.length > 0 ? (
        <Item label="Cost" value={costs.join(" · ")} />
      ) : null}
      {throttle ? (
        <Item
          label="Throttle"
          value={`${throttle.currentlyAvailable.toLocaleString()} / ${throttle.maximumAvailable.toLocaleString()} · +${throttle.restoreRate}/s`}
        />
      ) : null}
      <Item label="Time" value={`${outcome.durationMs} ms`} />
      {shopifyRequestId ? (
        <Item label="Request" tone="muted" value={shopifyRequestId} />
      ) : null}
    </Bar>
  );
}
