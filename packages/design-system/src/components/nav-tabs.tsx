import type { ComponentType, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface NavTab {
  count?: number | string | undefined;
  current: boolean;
  /** A link target; without it the tab is a button that calls `onSelect`. */
  href?: string | undefined;
  key: string;
  label: ReactNode;
  onSelect?: (() => void) | undefined;
}

type TabLink = ComponentType<{
  "aria-current"?: "page" | undefined;
  children: ReactNode;
  className?: string;
  href: string;
}>;

const VARIANTS = {
  /** Underline tabs inside the 52px shell header. */
  header: {
    list: "flex h-full items-stretch gap-[18px] self-stretch",
    tab: "inline-flex h-full items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-muted-foreground shadow-[inset_0_-2px_0_transparent] outline-none hover:text-foreground focus-visible:text-foreground aria-[current=page]:text-foreground aria-[current=page]:shadow-[inset_0_-2px_0_var(--foreground)]",
  },
  /** Underline tabs at the top of a page section. */
  page: {
    list: "flex gap-5 overflow-x-auto border-border border-b",
    tab: "inline-flex h-[38px] items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-muted-foreground shadow-[inset_0_-2px_0_transparent] outline-none hover:text-foreground focus-visible:text-foreground aria-[current=page]:text-foreground aria-[current=page]:shadow-[inset_0_-2px_0_var(--foreground)]",
  },
  /** A segmented track for a sub-section switch. */
  segmented: {
    list: "inline-flex gap-0.5 self-start rounded-lg bg-hover p-0.5",
    tab: "inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-[0_0_0_1px_var(--border),0_1px_2px_rgba(22,23,26,0.06)]",
  },
} as const;

/**
 * Navigation between sibling views (sections of a tool, sub-pages of a
 * page). Each tab is a link, or a button when the caller guards navigation.
 */
export const NavTabs = ({
  "aria-label": ariaLabel,
  className,
  linkComponent: Link,
  tabs,
  variant = "page",
}: {
  "aria-label": string;
  className?: string | undefined;
  linkComponent?: TabLink | undefined;
  tabs: readonly NavTab[];
  variant?: keyof typeof VARIANTS;
}) => (
  <nav aria-label={ariaLabel} className={cn(VARIANTS[variant].list, className)}>
    {tabs.map((tab) => {
      const content = (
        <>
          {tab.label}
          {tab.count === undefined ? null : (
            <span className="text-[11px] text-faint tabular-nums">
              {tab.count}
            </span>
          )}
        </>
      );
      const current = tab.current ? ("page" as const) : undefined;
      if (tab.href) {
        return Link ? (
          <Link
            aria-current={current}
            className={VARIANTS[variant].tab}
            href={tab.href}
            key={tab.key}
          >
            {content}
          </Link>
        ) : (
          <a
            aria-current={current}
            className={VARIANTS[variant].tab}
            href={tab.href}
            key={tab.key}
          >
            {content}
          </a>
        );
      }
      return (
        <button
          aria-current={current}
          className={VARIANTS[variant].tab}
          key={tab.key}
          onClick={tab.onSelect}
          type="button"
        >
          {content}
        </button>
      );
    })}
  </nav>
);
