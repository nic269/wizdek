import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** Page padding and width: 28px top, 32px sides, 48px bottom, centred. */
export const Page = ({
  children,
  className,
  width = "default",
}: {
  children: ReactNode;
  className?: string | undefined;
  /** `default` is 1400px wide, `narrow` 1180px, `full` fills the panel with no padding. */
  width?: "default" | "narrow" | "full" | undefined;
}) => (
  <div
    className={cn(
      width === "full"
        ? "flex min-h-0 flex-1 flex-col"
        : "mx-auto flex w-full flex-col gap-[18px] px-4 pt-6 pb-12 sm:px-8 sm:pt-7",
      width === "default" && "max-w-[1400px]",
      width === "narrow" && "max-w-[1180px] gap-[22px]",
      className
    )}
  >
    {children}
  </div>
);

/** Small label above a group: sentence case in Paper, mono caps in Console. */
export const SectionLabel = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) => (
  <div
    className={cn(
      "font-(family-name:--label-font) text-(length:--label-size) font-medium text-muted-foreground leading-none tracking-(--label-tracking) [text-transform:var(--label-transform)]",
      className
    )}
  >
    {children}
  </div>
);

export const PageHeader = ({
  title,
  description,
  actions,
  back,
  eyebrow,
  titleAdornment,
  className,
}: {
  title: ReactNode;
  description?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  /** A back link shown above the title. */
  back?: ReactNode | undefined;
  /** A label above the title, such as the date on the dashboard. */
  eyebrow?: ReactNode | undefined;
  /** Tags and badges after the title. */
  titleAdornment?: ReactNode | undefined;
  className?: string | undefined;
}) => (
  <header
    className={cn(
      "flex flex-wrap items-end gap-4 border-border border-b pb-[18px]",
      className
    )}
  >
    <div className="flex min-w-[min(100%,240px)] flex-1 flex-col">
      {back ? <div className="mb-2.5">{back}</div> : null}
      {eyebrow ? <SectionLabel className="mb-2">{eyebrow}</SectionLabel> : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <h1 className="m-0 font-semibold text-2xl text-foreground leading-[1.15] tracking-[-0.02em]">
          {title}
        </h1>
        {titleAdornment}
      </div>
      {description ? (
        <p className="mt-1.5 max-w-[720px] text-pretty text-muted-foreground text-sm leading-normal">
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

/** A section heading inside a page: 16/600 title with optional actions. */
export const SectionHeader = ({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  className?: string | undefined;
}) => (
  <div className={cn("flex flex-wrap items-end gap-3", className)}>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <h2 className="m-0 font-semibold text-base leading-[1.3]">{title}</h2>
      {description ? (
        <p className="text-[13px] text-muted-foreground leading-normal">
          {description}
        </p>
      ) : null}
    </div>
    {actions ? (
      <div className="flex flex-none items-center gap-2">{actions}</div>
    ) : null}
  </div>
);
