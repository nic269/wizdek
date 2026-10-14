"use client";

import { MenuIcon, PanelLeftIcon, SearchIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Input } from "./input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Kbd } from "./ui/kbd";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";

export interface AppShellNavItem {
  href: string;
  icon: ReactNode;
  label: string;
}
export interface AppShellLinkProps {
  "aria-current"?: "page" | undefined;
  "aria-label"?: string | undefined;
  children: ReactNode;
  className?: string;
  href: string;
  onClick?: () => void;
  title?: string | undefined;
}

export type AppShellLinkComponent = ComponentType<AppShellLinkProps>;

export interface AppShellProps {
  brand?: string;
  brandMark?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsed?: boolean;
  currentPath?: string;
  linkComponent?: AppShellLinkComponent;
  navItems?: readonly AppShellNavItem[];
  onCollapsedChange?: (collapsed: boolean) => void;
  searchLabel?: string;
  sidebar?: ReactNode;
  surfaceClassName?: string;
  topbar?: ReactNode;
}

interface ShellNavigationProps {
  brand: string;
  brandMark?: ReactNode;
  collapsed: boolean;
  currentPath: string;
  linkComponent: AppShellLinkComponent | undefined;
  mobile?: boolean;
  navItems: readonly AppShellNavItem[];
  onCollapseToggle: (() => void) | undefined;
  onNavigate: () => void;
  onSearchOpen: () => void;
  searchLabel: string;
  sidebar?: ReactNode;
  topbar?: ReactNode;
}

const BrandMark = ({
  brand,
  brandMark,
  title,
}: {
  brand: string;
  brandMark?: ReactNode;
  title?: string | undefined;
}) => (
  <div
    className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-[var(--foreground)] font-semibold text-[var(--background)] text-sm"
    title={title}
  >
    {brandMark ?? <span aria-hidden="true">{brand.slice(0, 1)}</span>}
    {brandMark ? null : <span className="sr-only">{brand}</span>}
  </div>
);

const railIconButtonClassName =
  "bg-transparent text-muted-foreground hover:bg-[var(--shell-hover,var(--muted))] hover:text-foreground aria-expanded:bg-transparent";

const ShellIdentity = ({
  brand,
  brandMark,
  collapsed,
  mobile,
  onCollapseToggle,
}: Pick<
  ShellNavigationProps,
  "brand" | "brandMark" | "collapsed" | "mobile" | "onCollapseToggle"
>) => {
  if (!mobile && collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-2">
        <BrandMark brand={brand} brandMark={brandMark} title={brand} />
        <Button
          aria-expanded="false"
          aria-label="Expand navigation"
          className={cn("size-9", railIconButtonClassName)}
          onClick={onCollapseToggle}
          size="icon-sm"
          title="Expand navigation"
          type="button"
          variant="ghost"
        >
          <PanelLeftIcon aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-2.5 pl-0.5",
        mobile ? "px-3 pt-3" : null
      )}
    >
      <BrandMark brand={brand} brandMark={brandMark} />
      <span className="flex-1 truncate font-semibold text-base text-foreground">
        {brand}
      </span>
      {mobile ? null : (
        <Button
          aria-expanded={!collapsed}
          aria-label="Collapse navigation"
          className={cn("size-8", railIconButtonClassName)}
          onClick={onCollapseToggle}
          size="icon-sm"
          title="Collapse navigation"
          type="button"
          variant="ghost"
        >
          <PanelLeftIcon aria-hidden="true" />
        </Button>
      )}
    </div>
  );
};

const ShellDestinations = ({
  collapsed,
  currentPath,
  mobile,
  linkComponent,
  navItems,
  onNavigate,
  sidebar,
}: Pick<
  ShellNavigationProps,
  | "collapsed"
  | "currentPath"
  | "mobile"
  | "linkComponent"
  | "navItems"
  | "onNavigate"
  | "sidebar"
>) => {
  const showLabels = mobile || !collapsed;
  const NavigationLink = linkComponent ?? "a";
  // Nested destinations (a settings page and its sub-pages) both match the
  // path, so only the most specific one is marked current.
  const activeHref = navItems
    .filter(
      ({ href }) =>
        currentPath === href ||
        (href !== "/" && currentPath.startsWith(`${href}/`))
    )
    .reduce<string | undefined>(
      (longest, { href }) =>
        longest && longest.length >= href.length ? longest : href,
      undefined
    );

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain",
        mobile ? "px-3" : null
      )}
    >
      {navItems.map((item) => {
        const active = item.href === activeHref;
        return (
          <NavigationLink
            aria-current={active ? "page" : undefined}
            aria-label={showLabels ? undefined : item.label}
            className={cn(
              "flex h-9 shrink-0 items-center gap-3 rounded-[6px] px-2.5 font-medium text-[var(--shell-nav-foreground,var(--foreground))] text-sm outline-none transition-[background-color,color] duration-150 hover:bg-[var(--shell-hover,var(--muted))] motion-reduce:transition-none",
              active
                ? "bg-[var(--foreground)] text-[var(--primary-foreground)] hover:bg-[var(--foreground)]"
                : null,
              showLabels ? "justify-between" : "justify-center"
            )}
            href={item.href}
            key={item.href}
            onClick={onNavigate}
            title={showLabels ? undefined : item.label}
          >
            {showLabels ? <span className="truncate">{item.label}</span> : null}
            <span aria-hidden="true" className="shrink-0">
              {item.icon}
            </span>
          </NavigationLink>
        );
      })}
      {showLabels ? <div>{sidebar}</div> : null}
    </nav>
  );
};

const ShellSearch = ({
  collapsed,
  mobile,
  onSearchOpen,
  searchLabel,
}: Pick<
  ShellNavigationProps,
  "collapsed" | "mobile" | "onSearchOpen" | "searchLabel"
>) => {
  if (!mobile && collapsed) {
    return (
      <div className="flex shrink-0 justify-center">
        <Button
          aria-keyshortcuts="Meta+K Control+K"
          aria-label={searchLabel}
          className={cn("size-9", railIconButtonClassName)}
          onClick={onSearchOpen}
          size="icon-sm"
          title={searchLabel}
          type="button"
          variant="ghost"
        >
          <SearchIcon aria-hidden="true" />
        </Button>
      </div>
    );
  }
  return (
    <Button
      aria-keyshortcuts="Meta+K Control+K"
      aria-label={searchLabel}
      className={cn(
        "h-9 shrink-0 justify-start gap-2.5 rounded-[6px] border-[var(--shell-hairline,var(--border))] bg-card pr-2 pl-2.5 font-normal text-[var(--shell-subtle-foreground,var(--muted-foreground))] hover:border-[var(--shell-hairline-strong,var(--ring))] hover:bg-card",
        mobile ? "mx-3" : null
      )}
      onClick={onSearchOpen}
      type="button"
      variant="outline"
    >
      <SearchIcon aria-hidden="true" />
      <span className="flex-1 text-left">Search</span>
      <Kbd className="h-auto rounded-[4px] border border-[var(--shell-hairline,var(--border))] bg-transparent px-[5px] py-1 text-[11px] leading-none">
        ⌘K
      </Kbd>
    </Button>
  );
};

const ShellNavigation = ({
  brand,
  brandMark,
  collapsed,
  currentPath,
  linkComponent,
  mobile = false,
  navItems,
  onCollapseToggle,
  onNavigate,
  onSearchOpen,
  searchLabel,
  sidebar,
  topbar,
}: ShellNavigationProps) => (
  <>
    <ShellIdentity
      brand={brand}
      brandMark={brandMark}
      collapsed={collapsed}
      mobile={mobile}
      onCollapseToggle={onCollapseToggle}
    />
    <ShellDestinations
      collapsed={collapsed}
      currentPath={currentPath}
      linkComponent={linkComponent}
      mobile={mobile}
      navItems={navItems}
      onNavigate={onNavigate}
      sidebar={sidebar}
    />
    <ShellSearch
      collapsed={collapsed}
      mobile={mobile}
      onSearchOpen={onSearchOpen}
      searchLabel={searchLabel}
    />
    {topbar ? (
      <div
        className={cn("shrink-0", mobile ? "px-3 pb-3" : null)}
        data-collapsed={collapsed && !mobile}
        data-shell-footer=""
      >
        {topbar}
      </div>
    ) : null}
  </>
);

export const AppShell = ({
  children,
  navItems = [],
  brand = "App",
  brandMark,
  collapsed: controlledCollapsed,
  linkComponent,
  sidebar,
  topbar,
  className,
  surfaceClassName,
  currentPath = "",
  onCollapsedChange,
  searchLabel = "Search",
}: AppShellProps) => {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const NavigationLink = linkComponent ?? "a";
  const handleCollapseToggle = () => {
    const nextCollapsed = !collapsed;
    if (controlledCollapsed === undefined) {
      setInternalCollapsed(nextCollapsed);
    }
    onCollapsedChange?.(nextCollapsed);
  };

  useEffect(() => {
    const openGlobalSearch = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setMobileNavOpen(false);
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openGlobalSearch);
    return () => window.removeEventListener("keydown", openGlobalSearch);
  }, []);

  useEffect(() => {
    if (currentPath) {
      contentRef.current?.focus();
      setMobileNavOpen(false);
    }
  }, [currentPath]);

  const searchResults = navItems.filter(({ label }) =>
    label.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  return (
    <div
      className={cn(
        "min-h-screen bg-[var(--shell-canvas,var(--muted))] text-foreground lg:h-dvh lg:overflow-hidden",
        surfaceClassName,
        className
      )}
    >
      <a
        className="sr-only z-50 rounded-lg bg-card px-4 py-3 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
        href="#main-content"
      >
        Skip to content
      </a>

      <div
        className={cn(
          "grid min-h-screen transition-[grid-template-columns] duration-200 motion-reduce:transition-none lg:h-dvh",
          collapsed
            ? "lg:grid-cols-[5.25rem_1fr]"
            : "lg:grid-cols-[16.75rem_1fr]"
        )}
      >
        <aside className="hidden py-4 pl-5 lg:block" data-collapsed={collapsed}>
          <div className="flex h-full flex-col gap-3.5 overflow-hidden py-2.5">
            <ShellNavigation
              brand={brand}
              brandMark={brandMark}
              collapsed={collapsed}
              currentPath={currentPath}
              linkComponent={linkComponent}
              navItems={navItems}
              onCollapseToggle={handleCollapseToggle}
              onNavigate={() => setMobileNavOpen(false)}
              onSearchOpen={() => setSearchOpen(true)}
              searchLabel={searchLabel}
              sidebar={sidebar}
              topbar={topbar}
            />
          </div>
        </aside>

        <main className="min-w-0 lg:flex lg:h-dvh lg:min-h-0 lg:flex-col lg:py-4 lg:pr-4 lg:pl-5">
          <header className="flex min-h-16 items-center justify-between gap-3 border-border border-b bg-card px-4 lg:hidden">
            <div className="flex items-center gap-3">
              <BrandMark brand={brand} brandMark={brandMark} />
              <span className="font-semibold text-sm">{brand}</span>
            </div>
            <Button
              aria-label="Open navigation"
              className="min-h-11 min-w-11 bg-transparent aria-expanded:bg-transparent"
              onClick={() => setMobileNavOpen(true)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <MenuIcon aria-hidden="true" />
            </Button>
          </header>

          <div
            className="flex flex-col p-4 outline-none lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-0"
            id="main-content"
            ref={contentRef}
            tabIndex={-1}
          >
            {children}
          </div>
        </main>
      </div>

      <Sheet onOpenChange={setMobileNavOpen} open={mobileNavOpen}>
        <SheetContent
          className={cn(
            "flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-3.5 bg-[var(--shell-canvas,var(--muted))] p-0 motion-reduce:transform-none motion-reduce:transition-none",
            surfaceClassName
          )}
          side="left"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <ShellNavigation
            brand={brand}
            brandMark={brandMark}
            collapsed={false}
            currentPath={currentPath}
            linkComponent={linkComponent}
            mobile
            navItems={navItems}
            onCollapseToggle={undefined}
            onNavigate={() => setMobileNavOpen(false)}
            onSearchOpen={() => {
              setMobileNavOpen(false);
              setSearchOpen(true);
            }}
            searchLabel={searchLabel}
            sidebar={sidebar}
            topbar={topbar}
          />
        </SheetContent>
      </Sheet>

      <Dialog
        onOpenChange={(open) => {
          setSearchOpen(open);
          if (!open) {
            setSearchQuery("");
          }
        }}
        open={searchOpen}
      >
        <DialogContent
          className={cn("motion-reduce:animate-none", surfaceClassName)}
        >
          <DialogHeader>
            <DialogTitle>{searchLabel}</DialogTitle>
            <DialogDescription>
              Search the destinations available to your account.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Search destinations"
            autoFocus
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Type a destination"
            value={searchQuery}
          />
          <nav aria-label="Search results" className="space-y-1">
            {searchResults.length ? (
              searchResults.map((item) => (
                <NavigationLink
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 outline-none hover:bg-muted"
                  href={item.href}
                  key={item.href}
                  onClick={() => setSearchOpen(false)}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </NavigationLink>
              ))
            ) : (
              <p className="px-3 py-4 text-muted-foreground text-sm">
                No available destinations match.
              </p>
            )}
          </nav>
        </DialogContent>
      </Dialog>
    </div>
  );
};
