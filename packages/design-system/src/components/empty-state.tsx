import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** A dashed card with an icon tile, a title, one sentence and one action. */
export const EmptyState = ({
  icon,
  iconTile = true,
  title,
  description,
  action,
  note,
  className,
}: {
  icon?: ReactNode | undefined;
  /** Draws the icon on a 44px tile; off for a group of chips. */
  iconTile?: boolean | undefined;
  title: string;
  description?: ReactNode | undefined;
  action?: ReactNode | undefined;
  /** A muted line under the action, such as who may perform it. */
  note?: ReactNode | undefined;
  className?: string | undefined;
}) => (
  <div
    className={cn(
      "flex flex-col items-center gap-2.5 rounded-card border border-input border-dashed px-6 py-14 text-center",
      className
    )}
  >
    {icon && !iconTile ? <div className="mb-1">{icon}</div> : null}
    {icon && iconTile ? (
      <div className="grid size-11 place-items-center rounded-[11px] border border-border bg-sunken text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
    ) : null}
    <h2 className="font-semibold text-base leading-[1.3]">{title}</h2>
    {description ? (
      <p className="max-w-[420px] text-pretty text-[13.5px] text-muted-foreground leading-normal">
        {description}
      </p>
    ) : null}
    {action ? <div className="mt-2">{action}</div> : null}
    {note ? (
      <p className="text-[12.5px] text-muted-foreground leading-[1.4]">
        {note}
      </p>
    ) : null}
  </div>
);
