import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export const PageHeader = ({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) => (
  <header
    className={cn(
      "flex flex-wrap items-end gap-x-4 gap-y-3 border-[var(--shell-hairline,var(--border))] border-b pb-5",
      className
    )}
  >
    <div className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-1.5">
      <h1 className="font-semibold text-[26px] text-foreground leading-[1.2] tracking-[-0.01em]">
        {title}
      </h1>
      {description ? (
        <p className="max-w-[560px] text-pretty text-[15px] text-muted-foreground leading-[1.45]">
          {description}
        </p>
      ) : null}
    </div>
    {actions ? (
      <div className="flex flex-none flex-wrap items-center gap-2">
        {actions}
      </div>
    ) : null}
  </header>
);
