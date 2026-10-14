"use client";

import type { ComponentType, ReactNode } from "react";
import { useState } from "react";
import { Menu, PanelLeft, Search, X } from "../icons";
import { cn } from "../lib/cn";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

export interface AppShellLinkProps {
  "aria-current"?: "page" | undefined;
  children: ReactNode;
  className?: string | undefined;
  href: string;
  onClick?: (() => void) | undefined;
  title?: string | undefined;
}

export interface AppShellIndicator {
  /** Text after the dot, such as "1" or "1 running". */
  label: string;
  /** Pulses the dot, for work in progress. */
  pulse?: boolean | undefined;
  tone: "warning" | "info";
}

export interface AppShellNavItem {
  href: string;
  icon: ReactNode;
  indicator?: AppShellIndicator | null | undefined;
  label: string;
}

export interface AppShellNavGroup {
  items: readonly AppShellNavItem[];
  label: string;
}

export interface AppShellProps {
  /** The signed-in account button at the foot of the sidebar. */
  account: ReactNode;
  brand: { meta: string; name: string };
  children: ReactNode;
  collapsed: boolean;
  currentPath: string;
  linkComponent: ComponentType<AppShellLinkProps>;
  navGroups: readonly AppShellNavGroup[];
  onCollapsedChange: (collapsed: boolean) => void;
  onSearch: () => void;
  /** The organization switcher under the brand. */
  organization: ReactNode;
}

const DOT_TONES = {
  info: "bg-(--status-info-dot)",
  warning: "bg-(--status-warning-dot)",
} as const;

/** The nav item whose href is the longest prefix of the path is current. */
const activeHrefOf = (groups: readonly AppShellNavGroup[], path: string) =>
  groups
    .flatMap(({ items }) => items)
    .filter(
      ({ href }) =>
        path === href || (href !== "/" && path.startsWith(`${href}/`))
    )
    .reduce<string | undefined>(
      (longest, { href }) =>
        longest && longest.length >= href.length ? longest : href,
      undefined
    );

const BrandMark = ({ size = 28 }: { size?: number }) => (
  <span
    aria-hidden="true"
    className="grid shrink-0 place-items-center bg-(--brand-mark) font-bold text-white leading-none tracking-[-0.04em]"
    style={{ borderRadius: 7, fontSize: size / 2, height: size, width: size }}
  >
    w
  </span>
);

const NavList = ({
  activeHref,
  groups,
  linkComponent: Link,
  mobile = false,
  onNavigate,
}: {
  activeHref: string | undefined;
  groups: readonly AppShellNavGroup[];
  linkComponent: ComponentType<AppShellLinkProps>;
  mobile?: boolean;
  onNavigate?: () => void;
}) => (
  <nav
    aria-label="Primary"
    className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overflow-x-hidden [scrollbar-width:none]"
  >
    {groups.map((group) => (
      <div className="flex flex-col gap-px" key={group.label}>
        <div
          className={cn(
            "font-(family-name:--label-font) text-(length:--label-size) px-2 pt-1 pb-[7px] font-medium text-sidebar-muted leading-none tracking-(--label-tracking) [text-transform:var(--label-transform)]",
            !mobile && "in-data-[collapsed=true]:hidden"
          )}
        >
          {group.label}
        </div>
        {group.items.map((item) => {
          const active = item.href === activeHref;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-[7px] px-2 font-medium text-sidebar-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                mobile ? "h-11 rounded-lg px-2.5 text-sm" : "h-8 text-[13.5px]",
                active
                  ? "bg-sidebar-active shadow-(--sidebar-active-shadow)"
                  : "hover:bg-sidebar-hover"
              )}
              href={item.href}
              key={item.href}
              onClick={onNavigate}
              title={item.label}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid w-4 shrink-0 place-items-center [&_svg]:size-4",
                  mobile && "w-[17px] [&_svg]:size-[17px]",
                  active ? "text-sidebar-foreground" : "text-sidebar-muted"
                )}
              >
                {item.icon}
              </span>
              <span
                className={cn(
                  "flex-1 truncate",
                  !mobile && "in-data-[collapsed=true]:hidden"
                )}
              >
                {item.label}
              </span>
              {item.indicator ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-[5px] font-medium text-[11px] text-sidebar-muted leading-none",
                    !mobile && "in-data-[collapsed=true]:hidden"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      DOT_TONES[item.indicator.tone],
                      item.indicator.pulse &&
                        "animate-[wz-pulse_1.6s_ease_infinite]"
                    )}
                  />
                  {item.indicator.label}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    ))}
  </nav>
);

/**
 * The product shell: a 244px sidebar on the canvas (a 60px rail when
 * collapsed) beside one white panel that scrolls on its own. Under 820px the
 * sidebar becomes a top bar with a left sheet.
 */
export const AppShell = ({
  account,
  brand,
  children,
  collapsed,
  currentPath,
  linkComponent,
  navGroups,
  onCollapsedChange,
  onSearch,
  organization,
}: AppShellProps) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeHref = activeHrefOf(navGroups, currentPath);
  const pageTitle =
    navGroups
      .flatMap(({ items }) => items)
      .find(({ href }) => href === activeHref)?.label ?? brand.name;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-sidebar text-sidebar-foreground min-[820px]:flex-row">
      <a
        className="sr-only z-50 rounded-lg bg-card px-3 py-2 text-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
        href="#main-content"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          "hidden flex-none flex-col gap-3.5 overflow-hidden px-2.5 pt-3.5 pb-3 transition-[width] duration-200 ease-out min-[820px]:flex",
          collapsed ? "w-[60px]" : "w-[244px]"
        )}
        data-collapsed={collapsed}
      >
        <div className="flex min-h-8 items-center gap-2 px-1">
          <BrandMark />
          <div className="flex in-data-[collapsed=true]:hidden min-w-0 flex-1 flex-col gap-0.5">
            <div className="whitespace-nowrap font-semibold text-sm leading-[1.1] tracking-[-0.01em]">
              {brand.name}
            </div>
            <div className="font-medium font-mono text-[10.5px] text-sidebar-muted leading-none tracking-[0.02em]">
              {brand.meta}
            </div>
          </div>
          <Button
            aria-label="Collapse sidebar"
            className="grid in-data-[collapsed=true]:hidden size-7 place-items-center rounded-md text-sidebar-muted outline-none hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            onClick={() => onCollapsedChange(true)}
            title="Collapse sidebar"
            type="button"
            variant="ghost"
          >
            <PanelLeft className="size-4" />
          </Button>
        </div>

        {organization}

        <Button
          aria-keyshortcuts="Meta+K"
          className="flex h-8 items-center in-data-[collapsed=true]:justify-center gap-2 rounded-[7px] border border-sidebar-border bg-sidebar-field in-data-[collapsed=true]:px-0 px-2 text-[13px] text-sidebar-muted outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          onClick={onSearch}
          title="Search or jump to…"
          type="button"
          variant="ghost"
        >
          <Search className="size-[15px] shrink-0" />
          <span className="in-data-[collapsed=true]:hidden flex-1 text-left">
            Search or jump to…
          </span>
          <kbd className="in-data-[collapsed=true]:hidden rounded border border-sidebar-border px-[5px] py-[3px] font-medium font-mono text-[10.5px] leading-none">
            ⌘K
          </kbd>
        </Button>

        <NavList
          activeHref={activeHref}
          groups={navGroups}
          linkComponent={linkComponent}
        />

        {collapsed ? (
          <Button
            aria-label="Expand sidebar"
            className="grid h-8 place-items-center rounded-[7px] text-sidebar-muted outline-none hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            onClick={() => onCollapsedChange(false)}
            title="Expand sidebar"
            type="button"
            variant="ghost"
          >
            <PanelLeft className="size-4" />
          </Button>
        ) : null}

        {account}
      </aside>

      <header className="flex h-[52px] flex-none items-center gap-2.5 px-3 min-[820px]:hidden">
        <Button
          aria-label="Open navigation"
          className="grid size-9 place-items-center rounded-lg border border-sidebar-border bg-sidebar-field text-sidebar-foreground"
          onClick={() => setSheetOpen(true)}
          type="button"
          variant="ghost"
        >
          <Menu className="size-[18px]" />
        </Button>
        <BrandMark size={26} />
        <div className="flex-1 truncate font-semibold text-sm">{pageTitle}</div>
        <Button
          aria-label="Search or jump to…"
          className="grid size-9 place-items-center rounded-lg border border-sidebar-border bg-sidebar-field text-sidebar-foreground"
          onClick={onSearch}
          type="button"
          variant="ghost"
        >
          <Search className="size-[17px]" />
        </Button>
      </header>

      <Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
        <SheetContent
          className="w-[280px] gap-3.5 bg-sidebar px-3 py-4 text-sidebar-foreground"
          showCloseButton={false}
          side="left"
        >
          <div className="flex items-center gap-2">
            <BrandMark />
            <SheetTitle className="flex-1 font-semibold text-sm">
              {brand.name}
            </SheetTitle>
            <Button
              aria-label="Close navigation"
              className="grid size-8 place-items-center text-sidebar-muted"
              onClick={() => setSheetOpen(false)}
              type="button"
              variant="ghost"
            >
              <X className="size-[18px]" />
            </Button>
          </div>
          {organization}
          <NavList
            activeHref={activeHref}
            groups={navGroups}
            linkComponent={linkComponent}
            mobile
            onNavigate={() => setSheetOpen(false)}
          />
          {account}
        </SheetContent>
      </Sheet>

      <main
        className="flex min-h-0 min-w-0 flex-1 px-2 pb-2 min-[820px]:pt-2 min-[820px]:pl-0"
        id="main-content"
      >
        <div className="relative flex min-w-0 flex-1 flex-col overflow-auto rounded-panel border border-sidebar-border bg-card text-foreground">
          {children}
        </div>
      </main>
    </div>
  );
};
