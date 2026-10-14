"use client";

import {
  Button,
  Check,
  CircleHelp,
  cn,
  LoaderCircle,
  Minus,
  X,
} from "@repo/design-system";
import type { FlowDefinition } from "@repo/flows/definition";
import type { ReactNode } from "react";
import { formatDuration } from "../../../../lib/format";
import { asCategory, CategoryChip } from "../../../node-visuals";
import { outcomeOf } from "../../flow-node";
import { specsByType } from "../../node-defaults";
import { summarizeNode } from "../../node-summary";
import { sumOf } from "./trace-model";
import type { RunDetail } from "./use-run-polling";

type FlowNode = FlowDefinition["nodes"][number];

const DOTS: Record<
  ReturnType<typeof outcomeOf>,
  { className: string; icon: ReactNode }
> = {
  failed: {
    className:
      "bg-(--status-danger-dot) text-white shadow-[0_0_0_1px_var(--status-danger-dot)]",
    icon: <X />,
  },
  idle: {
    className: "bg-card text-faint shadow-[0_0_0_1px_var(--input)]",
    icon: <Minus />,
  },
  running: {
    className:
      "bg-(--status-info-dot) text-white shadow-[0_0_0_1px_var(--status-info-dot)]",
    icon: <LoaderCircle className="animate-spin" />,
  },
  succeeded: {
    className:
      "bg-(--status-success-dot) text-white shadow-[0_0_0_1px_var(--status-success-dot)]",
    icon: <Check />,
  },
  unknown: {
    className:
      "bg-(--status-unknown-bg) text-white shadow-[0_0_0_1px_var(--status-unknown-bg)]",
    icon: <CircleHelp />,
  },
};

interface Segment {
  className: string;
  count: number;
  label: string;
}

/**
 * What a step did with its items. A step with several outputs is shown by
 * where its items went ("61 → true"); the others by item status.
 */
const segmentsOf = (
  summary: RunDetail["nodes"][string] | undefined
): Segment[] => {
  const counts = summary?.counts ?? {};
  const emitted = Object.entries(summary?.emitted ?? {}).filter(
    ([, count]) => count > 0
  );
  const segments: Segment[] = [];
  if (emitted.length > 1) {
    for (const [index, [handle, count]] of emitted.entries()) {
      segments.push({
        className:
          index === 0
            ? "bg-(--status-info-bg) text-(--status-info-fg) [--seg:var(--status-info-dot)]"
            : "bg-(--status-neutral-bg) text-(--status-neutral-fg) [--seg:#c4c4bd]",
        count,
        label: `${count.toLocaleString()} → ${handle}`,
      });
    }
  } else {
    segments.push({
      className:
        "bg-(--status-success-bg) text-(--status-success-fg) [--seg:var(--status-success-dot)]",
      count: counts.SUCCEEDED ?? 0,
      label: `${(counts.SUCCEEDED ?? 0).toLocaleString()} succeeded`,
    });
  }
  segments.push(
    {
      className:
        "bg-(--status-danger-bg) text-(--status-danger-fg) [--seg:var(--status-danger-dot)]",
      count: counts.FAILED ?? 0,
      label: `${(counts.FAILED ?? 0).toLocaleString()} failed`,
    },
    {
      className:
        "bg-(--status-unknown-bg) text-white [--seg:var(--status-unknown-bg)]",
      count: counts.UNKNOWN ?? 0,
      label: `${(counts.UNKNOWN ?? 0).toLocaleString()} unknown`,
    },
    {
      className:
        "bg-(--status-info-bg) text-(--status-info-fg) [--seg:var(--status-info-dot)]",
      count: (counts.PENDING ?? 0) + (counts.IN_PROGRESS ?? 0),
      label: `${((counts.PENDING ?? 0) + (counts.IN_PROGRESS ?? 0)).toLocaleString()} waiting`,
    }
  );
  return segments.filter(({ count }) => count > 0);
};

const StepCard = ({
  active,
  node,
  onPick,
  summary,
}: {
  active: boolean;
  node: FlowNode;
  onPick: () => void;
  summary: RunDetail["nodes"][string] | undefined;
}) => {
  const spec = specsByType.get(node.type);
  const counts = summary?.counts ?? {};
  const received = sumOf(counts);
  const sent = sumOf(summary?.emitted ?? {});
  const outcome = outcomeOf({ counts, status: summary?.step?.status ?? null });
  const segments = segmentsOf(summary);
  const barTotal = segments.reduce((total, { count }) => total + count, 0);
  const step = summary?.step;
  return (
    <Button
      aria-pressed={active}
      className={cn(
        "mb-3.5 h-auto w-full flex-col items-stretch justify-start gap-2.5 whitespace-normal rounded-card bg-card px-3.5 py-3 text-left font-normal text-foreground hover:bg-card",
        active && "border-accent shadow-[0_0_0_3px_var(--accent-soft)]",
        !active && outcome === "unknown" && "border-(--alert-unknown-border)",
        !active && outcome !== "unknown" && "border-border hover:border-input"
      )}
      onClick={onPick}
      type="button"
      variant="ghost"
    >
      <span className="flex w-full items-center gap-2.5">
        <CategoryChip
          category={asCategory(spec?.category)}
          nodeType={node.type}
          size={26}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-[13.5px] leading-[1.25]">
            {node.name || spec?.label || node.type}
          </span>
          <span className="block truncate text-muted-foreground text-xs leading-[1.35]">
            {summarizeNode(node.type, node.config) || spec?.description}
          </span>
        </span>
        <span className="font-medium font-mono text-muted-foreground text-xs">
          {step?.startedAt
            ? formatDuration(step.startedAt, step.completedAt)
            : "—"}
        </span>
      </span>
      <span className="flex w-full flex-wrap items-center gap-1.5">
        <span className="mr-1 font-medium font-mono text-[11.5px] text-muted-foreground">
          {received === sent || sent === 0
            ? `${received.toLocaleString()} in`
            : `${received.toLocaleString()} in → ${sent.toLocaleString()} out`}
        </span>
        {segments.map((segment) => (
          <span
            className={cn(
              "inline-flex h-[22px] items-center gap-[5px] rounded-full px-2 font-semibold text-[11.5px] leading-none",
              segment.className
            )}
            key={segment.label}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-(--seg)"
            />
            {segment.label}
          </span>
        ))}
        {step?.status === "SKIPPED" ? (
          <span className="text-muted-foreground text-xs">
            Skipped — no items arrived
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className="flex h-[5px] w-full overflow-hidden rounded-full bg-border"
      >
        {segments.map((segment) => (
          <span
            className={cn("bg-(--seg)", segment.className)}
            key={segment.label}
            style={{
              width: barTotal ? `${(segment.count / barTotal) * 100}%` : 0,
            }}
          />
        ))}
      </span>
    </Button>
  );
};

/** The run as a vertical timeline of its steps. Clicking one scopes the items. */
export function RunTimeline({
  nodes,
  onSelectStep,
  selectedStep,
  steps,
}: {
  nodes: RunDetail["nodes"];
  onSelectStep: (nodeId: string | null) => void;
  selectedStep: string | null;
  steps: FlowNode[];
}) {
  return (
    <ol
      aria-label="Steps"
      className="flex flex-col px-[22px] pt-[18px] pb-[30px]"
    >
      {steps.map((node, index) => {
        const summary = nodes[node.id];
        const dot =
          DOTS[
            outcomeOf({
              counts: summary?.counts ?? {},
              status: summary?.step?.status ?? null,
            })
          ];
        return (
          <li
            className="grid grid-cols-[28px_minmax(0,1fr)] gap-3.5"
            key={node.id}
          >
            <span className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-[26px] shrink-0 place-items-center rounded-full border-2 border-white [&_svg]:size-[13px]",
                  dot.className
                )}
              >
                {dot.icon}
              </span>
              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="min-h-3.5 w-0.5 flex-1 bg-border"
                />
              ) : null}
            </span>
            <StepCard
              active={selectedStep === node.id}
              node={node}
              onPick={() =>
                onSelectStep(selectedStep === node.id ? null : node.id)
              }
              summary={summary}
            />
          </li>
        );
      })}
    </ol>
  );
}
