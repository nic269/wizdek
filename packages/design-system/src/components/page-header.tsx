import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { ShellActions } from "./shell-header";

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
        : "mx-auto flex w-full flex-col gap-6 pt-6 pr-4 pb-10 pl-5 sm:pt-7",
      width === "default",
      width === "narrow" && "max-w-[1280px] gap-[22px]",
      className
    )}
  >
    {children}
  </div>
);

/** Small caps label above a group. */
export const SectionLabel = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) => (
  <div
    className={cn(
      "font-(family-name:--label-font) text-(length:--label-size) font-medium text-faint leading-none tracking-(--label-tracking) [text-transform:var(--label-transform)]",
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
  aside,
  back,
  eyebrow,
  titleAdornment,
  size = "title",
  className,
}: {
  title: ReactNode;
  /** `display` is the 28px greeting size used on the dashboard. */
  size?: "display" | "title" | undefined;
  description?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  /** Status content at the end of the title row; it stays in the page. */
  aside?: ReactNode | undefined;
  /** A back link shown above the title. */
  back?: ReactNode | undefined;
  /** A label above the title, such as the date on the dashboard. */
  eyebrow?: ReactNode | undefined;
  /** Tags and badges after the title. */
  titleAdornment?: ReactNode | undefined;
  className?: string | undefined;
}) => (
  <header className={cn("flex flex-wrap items-end gap-4", className)}>
    <div className="flex min-w-[min(100%,240px)] flex-1 flex-col">
      {back ? <div className="mb-2.5">{back}</div> : null}
      {eyebrow ? (
        <SectionLabel className={size === "display" ? "mb-1.5" : "mb-2"}>
          {eyebrow}
        </SectionLabel>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <h1
          className={cn(
            "m-0 font-semibold text-foreground",
            size === "display"
              ? "text-[28px] leading-[34px] tracking-[-0.025em]"
              : "text-[20px] leading-7 tracking-[-0.018em]"
          )}
        >
          {title}
        </h1>
        {titleAdornment}
      </div>
      {description ? (
        <p
          className={cn(
            "max-w-[640px] text-pretty text-[13px] text-muted-foreground leading-normal",
            size === "display" ? "mt-1.5" : "mt-1"
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
    {aside ? <div className="flex flex-none items-center">{aside}</div> : null}
    {actions ? <ShellActions>{actions}</ShellActions> : null}
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
      <h2 className="m-0 font-semibold text-[15px] leading-[22px] tracking-[-0.01em]">
        {title}
      </h2>
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
