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
  <div
    className={cn(
      "flex flex-col gap-4 border-border border-b pb-6 sm:flex-row sm:items-end sm:justify-between",
      className
    )}
  >
    <div className="space-y-1">
      <h1 className="font-semibold text-2xl text-foreground tracking-normal">
        {title}
      </h1>
      {description ? (
        <p className="max-w-2xl text-muted-foreground text-sm">{description}</p>
      ) : null}
    </div>
    {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
  </div>
);
