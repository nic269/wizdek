import { cn } from "../lib/cn";

export type Environment = "PROD" | "STAGING" | "DEV";

const ENV_CLASSES: Record<Environment, string> = {
  DEV: "bg-(--env-dev-bg) text-(--env-dev-fg)",
  PROD: "bg-(--env-prod-bg) text-(--env-prod-fg)",
  STAGING:
    "bg-(--env-staging-bg) text-(--env-staging-fg) shadow-[inset_0_0_0_1px_var(--env-staging-ring)]",
};

/** The risk signal that sits next to every store or database name. */
export const EnvTag = ({
  environment,
  className,
}: {
  environment: Environment;
  className?: string | undefined;
}) => (
  <span
    className={cn(
      "inline-flex h-5 shrink-0 items-center rounded-[5px] px-[7px] font-medium text-[10.5px] uppercase leading-none tracking-[0.05em]",
      ENV_CLASSES[environment],
      className
    )}
    title={ENVIRONMENT_LABELS[environment]}
  >
    {ENVIRONMENT_SHORT_LABELS[environment]}
  </span>
);

/** The short tag text; the full label is the tag's tooltip. */
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
