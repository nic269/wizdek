import { cn } from "../lib/cn";

export type Environment = "PROD" | "STAGING" | "DEV";

const ENV_CLASSES: Record<Environment, string> = {
  DEV: "bg-(--env-dev-bg) text-(--env-dev-fg)",
  PROD: "bg-(--env-prod-bg) text-(--env-prod-fg)",
  STAGING: "bg-(--env-staging-bg) text-(--env-staging-fg)",
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
      "inline-flex shrink-0 items-center rounded-[3px] px-[5px] py-[3px] font-mono font-semibold text-[9.5px] uppercase leading-none tracking-[0.06em]",
      ENV_CLASSES[environment],
      className
    )}
    title={ENVIRONMENT_LABELS[environment]}
  >
    {environment}
  </span>
);

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  DEV: "Development",
  PROD: "Production",
  STAGING: "Staging",
};
