"use client";

import { ArrowRight, Button, Check, cn, toast } from "@repo/design-system";
import Link from "next/link";

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
 * The setup checklist: one bar per step. Done steps are struck through, the
 * next one is a link, the rest wait.
 */
export const OnboardingChecklist = ({
  onDismiss,
  steps,
}: {
  onDismiss: () => void;
  organizationName?: string | undefined;
  steps: OnboardingStep[];
}) => {
  const doneCount = steps.filter(({ done }) => done).length;
  const nextIndex = steps.findIndex(({ done }) => !done);
  return (
    <section
      aria-labelledby="setup-checklist-title"
      className="flex flex-col gap-3.5 rounded-card bg-card px-[18px] py-4 shadow-card"
    >
      <div className="flex items-center gap-2">
        <h2
          className="font-semibold text-[15px] leading-[22px] tracking-[-0.01em]"
          id="setup-checklist-title"
        >
          Finish setting up
        </h2>
        <span className="text-faint text-xs tabular-nums">
          {doneCount} of {steps.length}
        </span>
        <span className="flex-1" />
        <Button
          onClick={() => {
            onDismiss();
            toast.info("Checklist hidden", {
              description: "Find it again under Settings.",
            });
          }}
          size="sm"
          variant="ghost"
        >
          Dismiss
        </Button>
      </div>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {steps.map((step, index) => {
          const isNext = index === nextIndex;
          return (
            <li className="flex flex-col gap-2" key={step.title}>
              <div
                aria-hidden="true"
                className={cn(
                  "h-[3px] rounded-sm",
                  step.done && "bg-foreground",
                  isNext && "bg-accent",
                  !(step.done || isNext) && "bg-border"
                )}
              />
              {step.done ? (
                <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <Check className="size-3.5 shrink-0" />
                  <s className="truncate">{step.title}</s>
                  <span className="sr-only">Done</span>
                </span>
              ) : null}
              {isNext ? (
                <Link
                  className="flex items-center gap-1.5 font-[550] text-[13px] text-accent-ink hover:text-accent"
                  href={step.href}
                  title={step.description}
                >
                  <span className="truncate">{step.title}</span>
                  <ArrowRight className="size-3.5 shrink-0" />
                </Link>
              ) : null}
              {step.done || isNext ? null : (
                <Link
                  className="truncate text-[13px] text-muted-foreground hover:text-foreground"
                  href={step.href}
                  title={step.description}
                >
                  {step.title}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};
