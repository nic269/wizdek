"use client";

import {
  ArrowRight,
  Button,
  buttonVariants,
  Check,
  cn,
  toast,
  X,
} from "@repo/design-system";
import Link from "next/link";

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five"];

export interface OnboardingStep {
  cta: string;
  description: string;
  done: boolean;
  /** Hint shown in the header while this is the next step. */
  hint: string;
  href: string;
  title: string;
}

/**
 * The setup checklist: five steps, done ones checked, the next one raised
 * with a primary call to action.
 */
export const OnboardingChecklist = ({
  onDismiss,
  organizationName,
  steps,
}: {
  onDismiss: () => void;
  organizationName: string;
  steps: OnboardingStep[];
}) => {
  const doneCount = steps.filter(({ done }) => done).length;
  const nextIndex = steps.findIndex(({ done }) => !done);
  const left = steps.length - doneCount;
  const next = steps[nextIndex];
  return (
    <section
      aria-label="Setup checklist"
      className="rounded-card border border-border bg-[linear-gradient(180deg,var(--sunken),var(--card)_70%)] px-5 pt-[18px] pb-5"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3.5">
        <div className="min-w-[220px] flex-1">
          <h2 className="font-semibold text-[15px] leading-[1.3]">
            Get {organizationName} ready
          </h2>
          <p className="text-[13px] text-muted-foreground leading-[1.45]">
            {left === 1
              ? "One step left."
              : `${COUNT_WORDS[left] ?? left} steps left.`}{" "}
            {next?.hint}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div
            aria-label={`${doneCount} of ${steps.length} steps done`}
            aria-valuemax={steps.length}
            aria-valuemin={0}
            aria-valuenow={doneCount}
            className="h-1.5 w-[140px] overflow-hidden rounded-full bg-border"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
          <span className="font-medium font-mono text-muted-foreground text-xs">
            {doneCount}/{steps.length}
          </span>
          <Button
            aria-label="Dismiss the checklist"
            className="text-muted-foreground"
            onClick={() => {
              onDismiss();
              toast.info("Checklist hidden", {
                description: "Find it again under Settings.",
              });
            }}
            size="icon-xs"
            title="Dismiss"
            variant="ghost"
          >
            <X className="size-[15px]" />
          </Button>
        </div>
      </div>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
        {steps.map((step, index) => {
          const isNext = index === nextIndex;
          return (
            <li
              className={cn(
                "flex min-h-28 flex-col gap-2.5 rounded-menu border p-3",
                isNext ? "border-accent bg-card" : "border-border"
              )}
              key={step.title}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-5 place-items-center rounded-full [&_svg]:size-3",
                    step.done && "bg-accent text-white",
                    isNext && "border-[1.5px] border-accent text-accent-ink",
                    !(step.done || isNext) &&
                      "border-[1.5px] border-input border-dashed text-faint"
                  )}
                >
                  {step.done ? <Check /> : null}
                  {isNext ? <ArrowRight /> : null}
                </span>
                <span className="font-medium font-mono text-[11px] text-muted-foreground">
                  STEP {index + 1}
                </span>
                {step.done ? <span className="sr-only">Done</span> : null}
              </div>
              <div
                className={cn(
                  "font-semibold text-[13.5px] leading-[1.3]",
                  step.done && "text-muted-foreground"
                )}
              >
                {step.title}
              </div>
              <p className="flex-1 text-[12.5px] text-muted-foreground leading-[1.4]">
                {step.description}
              </p>
              {step.done ? null : (
                <Link
                  className={cn(
                    buttonVariants({
                      size: "xs",
                      variant: isNext ? "default" : "outline",
                    }),
                    "self-start"
                  )}
                  href={step.href}
                >
                  {step.cta}
                  <ArrowRight className="size-[13px]" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};
