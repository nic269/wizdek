"use client";

import type { ExecutionOutcome } from "./use-console-fetcher";

function Item({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "bad" | "good";
  value: string | number;
}) {
  const toneClassName = {
    bad: "text-destructive",
    default: "text-foreground",
    good: "text-emerald-600 dark:text-emerald-400",
  }[tone];
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground">{label}: </span>
      <span className={`font-medium ${toneClassName}`}>{value}</span>
    </span>
  );
}

const countTone = (count: number) => (count > 0 ? "bad" : "default");

/** Summarises the last execution: status, error counts, cost and throttle. */
export function ResponseStatusBar({
  outcome,
}: {
  outcome: ExecutionOutcome | null;
}) {
  if (!outcome) {
    return (
      <div
        className="border-t px-3 py-2 text-muted-foreground text-xs"
        data-testid="response-status-bar"
      >
        Run a query to see its status and cost.
      </div>
    );
  }

  if (outcome.kind === "refused") {
    return (
      <div
        className="border-t px-3 py-2 text-destructive text-xs"
        data-testid="response-status-bar"
      >
        Not sent to Shopify: {outcome.message}
      </div>
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

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs"
      data-testid="response-status-bar"
    >
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
      {cost?.requestedQueryCost === undefined ? null : (
        <Item label="Requested cost" value={cost.requestedQueryCost} />
      )}
      {cost?.actualQueryCost === undefined ? null : (
        <Item label="Actual cost" value={cost.actualQueryCost} />
      )}
      {throttle ? (
        <Item
          label="Throttle"
          value={`${throttle.currentlyAvailable} / ${throttle.maximumAvailable} (+${throttle.restoreRate}/s)`}
        />
      ) : null}
      <Item label="Time" value={`${outcome.durationMs} ms`} />
      {shopifyRequestId ? (
        <Item label="Request ID" value={shopifyRequestId} />
      ) : null}
    </div>
  );
}
