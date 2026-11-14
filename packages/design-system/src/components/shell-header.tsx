"use client";

import type { ReactNode } from "react";
import {
  createContext,
  Fragment,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { TriangleAlert } from "../icons";
import { cn } from "../lib/cn";

export type ShellRisk = "production" | "staging" | undefined;

interface ShellHeaderSlots {
  below: HTMLElement | null;
  lead: HTMLElement | null;
  setOverride: (override: { crumbs: boolean; risk: ShellRisk }) => void;
  trail: HTMLElement | null;
}

const ShellHeaderContext = createContext<ShellHeaderSlots | null>(null);

export const ShellHeaderProvider = ShellHeaderContext.Provider;

export interface ShellCrumb {
  href?: string | undefined;
  label: ReactNode;
}

type CrumbLink = (props: {
  children: ReactNode;
  className?: string;
  href: string;
}) => ReactNode;

const CrumbItem = ({
  item,
  last,
  linkComponent: Link,
}: {
  item: ShellCrumb;
  last: boolean;
  linkComponent?: CrumbLink | undefined;
}) => {
  if (last) {
    return (
      <span aria-current="page" className="truncate font-[550] text-foreground">
        {item.label}
      </span>
    );
  }
  if (!item.href) {
    return <span className="truncate">{item.label}</span>;
  }
  const className = "truncate text-muted-foreground hover:text-foreground";
  return Link ? (
    <Link className={className} href={item.href}>
      {item.label}
    </Link>
  ) : (
    <a className={className} href={item.href}>
      {item.label}
    </a>
  );
};

/** The breadcrumb the shell header shows: "Group / Page / Detail". */
export const Crumbs = ({
  items,
  linkComponent: Link,
}: {
  items: readonly ShellCrumb[];
  linkComponent?:
    | ((props: {
        children: ReactNode;
        className?: string;
        href: string;
      }) => ReactNode)
    | undefined;
}) => (
  <nav
    aria-label="Breadcrumb"
    className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground"
  >
    {items.map((item, index) => {
      const last = index === items.length - 1;
      const key = `${index}-${typeof item.label === "string" ? item.label : ""}`;
      return (
        <Fragment key={key}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-ghost">
              /
            </span>
          ) : null}
          <CrumbItem item={item} last={last} linkComponent={Link} />
        </Fragment>
      );
    })}
  </nav>
);

/**
 * Puts page content into the shell header. The shell draws the bar; a page
 * fills the breadcrumb (or tabs), the context chip and its actions, and can
 * mark the target as production, which tints the header and rings the panel.
 */
export const ShellHeader = ({
  crumbs,
  lead,
  context,
  actions,
  below,
  risk,
  productionNote,
  linkComponent,
}: {
  /** Replaces the breadcrumb the shell derives from the navigation. */
  crumbs?: readonly ShellCrumb[] | undefined;
  /** Extra content after the breadcrumb, such as tabs inside the header. */
  lead?: ReactNode | undefined;
  /** The store, database or environment the page acts on. */
  context?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  /** Content directly under the header bar, above the page. */
  below?: ReactNode | undefined;
  risk?: ShellRisk;
  /** The text of the production strip; shown when `risk` is production. */
  productionNote?: ReactNode | undefined;
  linkComponent?:
    | ((props: {
        children: ReactNode;
        className?: string;
        href: string;
      }) => ReactNode)
    | undefined;
}) => {
  const slots = useContext(ShellHeaderContext);
  const hasCrumbs = Boolean(crumbs);
  const setOverride = slots?.setOverride;

  useLayoutEffect(() => {
    if (!setOverride) {
      return;
    }
    setOverride({ crumbs: hasCrumbs, risk });
    return () => setOverride({ crumbs: false, risk: undefined });
  }, [setOverride, hasCrumbs, risk]);

  const leadContent =
    crumbs || lead ? (
      <>
        {crumbs?.length ? (
          <Crumbs items={crumbs} linkComponent={linkComponent} />
        ) : null}
        {lead}
      </>
    ) : null;
  const trailContent =
    context || actions ? (
      <>
        {context}
        {actions}
      </>
    ) : null;
  const belowContent =
    risk === "production" || below ? (
      <>
        {risk === "production" ? (
          <ProductionStrip>{productionNote}</ProductionStrip>
        ) : null}
        {below}
      </>
    ) : null;

  // Outside the shell (tests, previews) the same bar renders in place.
  if (!slots) {
    return (
      <div className="flex-none">
        <header
          className={cn(
            "flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 border-border border-b py-2 pr-4 pl-5",
            risk === "production" && "border-prod-line bg-prod-soft"
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-4 self-stretch">
            {leadContent}
          </div>
          {trailContent ? (
            <div className="flex flex-none flex-wrap items-center gap-2">
              {trailContent}
            </div>
          ) : null}
        </header>
        {belowContent}
      </div>
    );
  }

  return (
    <>
      {slots.lead && leadContent ? createPortal(leadContent, slots.lead) : null}
      {slots.trail && trailContent
        ? createPortal(trailContent, slots.trail)
        : null}
      {slots.below && belowContent
        ? createPortal(belowContent, slots.below)
        : null}
    </>
  );
};

/**
 * Page actions: inside the shell they move into the header bar, elsewhere
 * (tests, previews) they render in place.
 */
export const ShellActions = ({ children }: { children: ReactNode }) => {
  const slots = useContext(ShellHeaderContext);
  if (!slots) {
    return (
      <div className="flex flex-none flex-wrap items-center gap-2">
        {children}
      </div>
    );
  }
  return slots.trail ? createPortal(children, slots.trail) : null;
};

/** The band under a production header: what is at stake, in one line. */
export const ProductionStrip = ({
  children,
  className,
}: {
  children?: ReactNode | undefined;
  className?: string | undefined;
}) => (
  <div
    className={cn(
      "flex items-center gap-2.5 border-prod-line border-b bg-prod-soft px-5 py-2 text-[12.5px] text-prod-ink",
      className
    )}
    role="status"
  >
    <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-prod" />
    <span className="min-w-0 flex-1">
      {children ?? "Production. Changes here affect live data."}
    </span>
  </div>
);

/** A small chip naming the target an action will affect. */
export const ContextChip = ({
  children,
  label,
  risk,
  className,
}: {
  children: ReactNode;
  /** A short caps key before the value, such as "Store". */
  label?: ReactNode | undefined;
  risk?: ShellRisk;
  className?: string | undefined;
}) => (
  <span
    className={cn(
      "inline-flex h-[30px] items-center gap-2 whitespace-nowrap rounded-lg bg-card px-2.5 font-medium text-[12.5px] shadow-[0_0_0_1px_var(--input)]",
      risk === "production" &&
        "shadow-[0_0_0_1px_var(--prod-line),0_0_0_3px_rgba(201,58,44,0.08)]",
      risk === "staging" && "shadow-[0_0_0_1px_var(--stg-line)]",
      className
    )}
  >
    {label ? (
      <span className="text-[10.5px] text-faint uppercase tracking-[0.05em]">
        {label}
      </span>
    ) : null}
    {children}
  </span>
);

/** Shell state for the header slots, used by AppShell. */
export const useShellHeaderState = () => {
  const [lead, setLead] = useState<HTMLElement | null>(null);
  const [trail, setTrail] = useState<HTMLElement | null>(null);
  const [below, setBelow] = useState<HTMLElement | null>(null);
  const [override, setOverride] = useState<{
    crumbs: boolean;
    risk: ShellRisk;
  }>({ crumbs: false, risk: undefined });
  return {
    override,
    refs: { setBelow, setLead, setTrail },
    slots: { below, lead, setOverride, trail },
  };
};
