import { cn } from "@repo/design-system";

/** Counts of a run's items by status, across its steps. */
export type ItemCounts = Record<string, number>;

export const summarizeItems = (counts: ItemCounts) => {
  const succeeded = counts.SUCCEEDED ?? 0;
  const failed = counts.FAILED ?? 0;
  const unknown = counts.UNKNOWN ?? 0;
  const running = (counts.PENDING ?? 0) + (counts.IN_PROGRESS ?? 0);
  return {
    failed,
    running,
    succeeded,
    total: succeeded + failed + unknown + running,
    unknown,
  };
};

/**
 * A 6px stacked bar of a run's items: succeeded, failed, unknown and still
 * running, in proportion.
 */
export const RunItemsBar = ({
  className,
  counts,
}: {
  className?: string | undefined;
  counts: ItemCounts;
}) => {
  const { failed, running, succeeded, total, unknown } = summarizeItems(counts);
  const width = (value: number) =>
    total > 0 ? `${(value / total) * 100}%` : "0%";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-1.5 overflow-hidden rounded-full bg-border",
        className
      )}
    >
      <div
        className="bg-(--status-success-dot)"
        style={{ width: width(succeeded) }}
      />
      <div
        className="bg-(--status-danger-dot)"
        style={{ width: width(failed) }}
      />
      <div
        className="bg-(--status-unknown-bg)"
        style={{ width: width(unknown) }}
      />
      <div
        className="bg-(--status-info-dot)"
        style={{ width: width(running) }}
      />
    </div>
  );
};
