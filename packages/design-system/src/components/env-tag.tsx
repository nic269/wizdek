import { cn } from "../lib/cn";

export type Environment = "PROD" | "STAGING" | "DEV";

const ENV_CLASSES: Record<Environment, string> = {
  DEV: "bg-(--env-dev-bg) text-(--env-dev-fg)",
  PROD: "bg-(--env-prod-bg) text-(--env-prod-fg)",
  STAGING:
    "bg-(--env-staging-bg) text-(--env-staging-fg) shadow-[inset_0_0_0_1px_var(--env-staging-ring)]",
};

/**
 * The risk signal that sits next to every store or database name. It spells
 * the environment out; `compact` is the short 16px form for dense rows.
 */
export const EnvTag = ({
  environment,
  compact = false,
  className,
}: {
  environment: Environment;
  compact?: boolean | undefined;
  className?: string | undefined;
}) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center rounded-[5px] font-semibold uppercase tabular-nums leading-none tracking-[0.05em]",
      compact ? "h-4 px-[5px] text-[9.5px]" : "h-5 px-[7px] text-[10.5px]",
      ENV_CLASSES[environment],
      className
    )}
    title={compact ? ENVIRONMENT_LABELS[environment] : undefined}
  >
    {compact
      ? ENVIRONMENT_SHORT_LABELS[environment]
      : ENVIRONMENT_LABELS[environment]}
  </span>
);

/** The compact tag text; the full label is then the tag's tooltip. */
export const ENVIRONMENT_SHORT_LABELS: Record<Environment, string> = {
  DEV: "Dev",
  PROD: "Prod",
  STAGING: "Stag",
};

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  DEV: "Development",
  PROD: "Production",
  STAGING: "Staging",
};
