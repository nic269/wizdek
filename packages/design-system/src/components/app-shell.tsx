"use client";

import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Menu, PanelLeft, Search, X } from "../icons";
import { cn } from "../lib/cn";
import { BrandIcon, BrandLogo } from "./brand-logo";
import {
  Crumbs,
  ShellHeaderProvider,
  useShellHeaderState,
} from "./shell-header";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface AppShellLinkProps {
  "aria-current"?: "page" | undefined;
  "aria-label"?: string | undefined;
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
  children?: readonly AppShellNavItem[] | undefined;
  href: string;
  icon: ReactNode;
  indicator?: AppShellIndicator | null | undefined;
  label: string;
  nested?: boolean | undefined;
}

export interface AppShellNavGroup {
  /** The rail icon for a group of several items. */
  icon?: ReactNode | undefined;
  items: readonly AppShellNavItem[];
  /** The caps heading; an empty label draws no heading (Dashboard). */
  label: string;
}

export interface AppShellProps {
  /** The signed-in account button at the foot of the sidebar. */
  account: ReactNode;
  brand: { meta: string; name: string; version?: string | undefined };
  children: ReactNode;
  collapsed: boolean;
  currentPath: string;
  linkComponent: ComponentType<AppShellLinkProps>;
  navGroups: readonly AppShellNavGroup[];
  onCollapsedChange: (collapsed: boolean) => void;
  onSearch: () => void;
  /** The organization switcher at the foot of the sidebar. */
  organization: ReactNode;
}

const DOT_TONES = {
  info: "bg-(--status-info-dot)",
  warning: "bg-(--status-warning-dot)",
} as const;

const flattenedItems = (items: readonly AppShellNavItem[]): AppShellNavItem[] =>
  items.flatMap((item) => [
    item,
    ...flattenedItems(item.children ?? []).map((child) => ({
      ...child,
      nested: true,
    })),
  ]);

/** The nav item whose href is the longest prefix of the path is current. */
const activeHrefOf = (groups: readonly AppShellNavGroup[], path: string) =>
  groups
    .flatMap(({ items }) => flattenedItems(items))
    .filter(
      ({ href }) =>
        path === href || (href !== "/" && path.startsWith(`${href}/`))
    )
    .reduce<string | undefined>(
      (longest, { href }) =>
        longest && longest.length >= href.length ? longest : href,
      undefined
    );

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    Boolean(target.closest(".cm-editor, .graphiql-editor")));

/** The Wizloft icon, drawn in the surrounding text colour. */
export const BrandMark = ({ size = 28 }: { size?: number }) => (
  <BrandIcon size={size} />
);

const Indicator = ({ indicator }: { indicator: AppShellIndicator }) => (
  <span className="inline-flex items-center gap-[5px] font-medium text-[11px] text-sidebar-muted tabular-nums leading-none">
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 rounded-full",
        DOT_TONES[indicator.tone],
        indicator.pulse && "animate-[wz-pulse_1.6s_ease_infinite]"
      )}
    />
    {indicator.label}
  </span>
);

const KEY_CLASS =
  "inline-grid h-[18px] min-w-[18px] place-items-center rounded-[5px] bg-white/15 px-1 font-medium text-[11px] text-white/85";

const Keys = ({ keys }: { keys: readonly string[] }) => (
  <span className="ml-2 inline-flex gap-[3px]">
    {keys.map((key) => (
      <span className={KEY_CLASS} key={key}>
        {key}
      </span>
    ))}
  </span>
);

/** The expanded list: caps group headings over their items. */
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
    className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden [scrollbar-width:none]"
  >
    {groups.map((group) => (
      <div className="flex flex-col gap-px" key={group.label || "home"}>
        {group.label ? (
          <div className="px-2 pt-1.5 pb-[7px] font-semibold text-[11px] text-faint uppercase leading-none tracking-[0.06em]">
            {group.label}
          </div>
        ) : null}
        {flattenedItems(group.items).map((item) => {
          const active = item.href === activeHref;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-[7px] px-2 font-[450] text-foreground-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                mobile ? "h-11 rounded-lg px-2.5 text-sm" : "h-8 text-[13px]",
                item.nested && "ml-5 border-sidebar-border border-l pl-3",
                active
                  ? "bg-sidebar-active font-[550] text-foreground shadow-(--sidebar-active-shadow)"
                  : "hover:bg-sidebar-hover hover:text-foreground"
              )}
              href={item.href}
              key={item.href}
              onClick={onNavigate}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid w-4 shrink-0 place-items-center [&_svg]:size-4",
                  mobile && "w-[17px] [&_svg]:size-[17px]",
                  active ? "text-foreground" : "text-sidebar-muted"
                )}
              >
                {item.icon}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.indicator ? <Indicator indicator={item.indicator} /> : null}
            </Link>
          );
        })}
      </div>
    ))}
  </nav>
);

const RAIL_BUTTON =
  "relative grid size-10 place-items-center rounded-[10px] text-sidebar-muted outline-none transition-colors hover:bg-sidebar-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-popup-open:bg-sidebar-hover data-popup-open:text-foreground [&_svg]:size-4";
const RAIL_ACTIVE =
  "bg-sidebar-active text-foreground shadow-(--sidebar-active-shadow) hover:bg-sidebar-active";
const TIP_CLASS =
  "rounded-lg bg-flyout px-2.5 py-1.5 font-medium text-[12.5px] text-white shadow-popover [&>svg]:hidden [&_[data-slot=tooltip-arrow]]:hidden";

const RailDot = ({ tone }: { tone: AppShellIndicator["tone"] }) => (
  <span
    aria-hidden="true"
    className={cn(
      "absolute top-[7px] right-[7px] size-[7px] rounded-full border-[1.5px] border-sidebar",
      DOT_TONES[tone]
    )}
  />
);

/** A single item on the rail: an icon link with a dark tooltip. */
const RailItem = ({
  active,
  item,
  linkComponent: Link,
}: {
  active: boolean;
  item: AppShellNavItem;
  linkComponent: ComponentType<AppShellLinkProps>;
}) => {
  const label = item.indicator
    ? `${item.label} · ${item.indicator.label}`
    : item.label;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            aria-current={active ? "page" : undefined}
            aria-label={label}
            className={cn(RAIL_BUTTON, active && RAIL_ACTIVE)}
            href={item.href}
          >
            {item.icon}
            {item.indicator ? <RailDot tone={item.indicator.tone} /> : null}
          </Link>
        }
      />
      <TooltipContent className={TIP_CLASS} side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
};

/** A group of several items on the rail: one icon that opens a dark flyout. */
const RailGroup = ({
  activeHref,
  group,
  linkComponent: Link,
}: {
  activeHref: string | undefined;
  group: AppShellNavGroup;
  linkComponent: ComponentType<AppShellLinkProps>;
}) => {
  const [open, setOpen] = useState(false);
  const items = flattenedItems(group.items);
  const active = items.some(({ href }) => href === activeHref);
  const indicator = items.find((item) => item.indicator)?.indicator;
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={group.label}
        className={cn(RAIL_BUTTON, active && RAIL_ACTIVE)}
        closeDelay={120}
        delay={60}
        openOnHover
      >
        {group.icon ?? items[0]?.icon}
        {indicator ? <RailDot tone={indicator.tone} /> : null}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        alignOffset={-6}
        className="w-[216px] gap-0.5 rounded-xl border-0 bg-flyout p-1.5 text-flyout-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_18px_40px_-12px_rgba(0,0,0,0.45)]"
        side="right"
        sideOffset={10}
      >
        <div className="px-2 pt-1.5 pb-1 font-semibold text-[11px] text-flyout-muted uppercase tracking-[0.06em]">
          {group.label}
        </div>
        {items.map((item) => {
          const current = item.href === activeHref;
          return (
            <Link
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-lg px-2 font-[450] text-[13px] outline-none hover:bg-white/8 hover:text-white focus-visible:ring-2 focus-visible:ring-[#8fa4f0] [&_svg]:size-4",
                current
                  ? "bg-white/12 font-[550] text-white [&_svg]:text-white"
                  : "[&_svg]:text-flyout-muted"
              )}
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
            >
              {item.icon}
              <span className="flex-1 truncate">{item.label}</span>
              {item.indicator ? (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#4a3810] px-[5px] font-semibold text-[#f2cf7a] text-[10.5px] tabular-nums">
                  {item.indicator.label}
                </span>
              ) : null}
            </Link>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};

const RailRule = () => (
  <span aria-hidden="true" className="my-1.5 h-px w-5 flex-none bg-input" />
);

/** The 60px rail: icon logo and version, icons, flyouts for groups. */
const Rail = ({
  activeHref,
  brand,
  groups,
  linkComponent,
  onExpand,
  onSearch,
}: {
  activeHref: string | undefined;
  brand: AppShellProps["brand"];
  groups: readonly AppShellNavGroup[];
  linkComponent: ComponentType<AppShellLinkProps>;
  onExpand: () => void;
  onSearch: () => void;
}) => (
  <div className="flex min-h-0 flex-col items-center gap-1">
    <div className="group/logo relative grid size-10 flex-none place-items-center">
      <span className="text-brand-ink transition-opacity group-focus-within/logo:opacity-0 group-hover/logo:opacity-0">
        <BrandIcon label={brand.name} size={28} />
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-keyshortcuts="Meta+B"
              aria-label="Expand navigation"
              className="absolute inset-0.5 grid place-items-center rounded-[10px] bg-card text-foreground opacity-0 shadow-[0_0_0_1px_var(--input),0_1px_2px_rgba(22,23,26,0.06)] outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/logo:opacity-100"
              onClick={onExpand}
              type="button"
            />
          }
        >
          <PanelLeft className="size-4" />
        </TooltipTrigger>
        <TooltipContent className={TIP_CLASS} side="right" sideOffset={10}>
          Expand navigation
          <Keys keys={["⌘", "B"]} />
        </TooltipContent>
      </Tooltip>
    </div>
    {brand.version ? (
      <span className="mb-2 font-medium text-[10.5px] text-faint tabular-nums leading-[14px]">
        {brand.version}
      </span>
    ) : null}

    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-keyshortcuts="Meta+K"
            aria-label="Search or jump to…"
            className={RAIL_BUTTON}
            onClick={onSearch}
            type="button"
          />
        }
      >
        <Search />
      </TooltipTrigger>
      <TooltipContent className={TIP_CLASS} side="right" sideOffset={10}>
        Search
        <Keys keys={["⌘", "K"]} />
      </TooltipContent>
    </Tooltip>
    <RailRule />

    <nav aria-label="Primary" className="flex flex-col items-center gap-1">
      {groups.map((group, index) => {
        const items = flattenedItems(group.items);
        const separated = index === groups.length - 1 && groups.length > 2;
        return (
          <div className="contents" key={group.label || "home"}>
            {separated ? <RailRule /> : null}
            {items.length > 1 ? (
              <RailGroup
                activeHref={activeHref}
                group={group}
                linkComponent={linkComponent}
              />
            ) : (
              items.map((item) => (
                <RailItem
                  active={item.href === activeHref}
                  item={item}
                  key={item.href}
                  linkComponent={linkComponent}
                />
              ))
            )}
          </div>
        );
      })}
    </nav>
  </div>
);

/**
 * The product shell: a 244px sidebar on the canvas (a 60px rail when
 * collapsed) beside one white panel that scrolls on its own and carries the
 * shell header. Under 820px the sidebar becomes a top bar with a left sheet.
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
  const header = useShellHeaderState();
  const activeHref = activeHrefOf(navGroups, currentPath);
  const activeGroup = navGroups.find(({ items }) =>
    flattenedItems(items).some(({ href }) => href === activeHref)
  );
  const activeItem = activeGroup
    ? flattenedItems(activeGroup.items).find(({ href }) => href === activeHref)
    : undefined;
  const pageTitle = activeItem?.label ?? brand.name;
  const defaultCrumbs = [
    ...(activeGroup?.label ? [{ label: activeGroup.label }] : []),
    { label: pageTitle },
  ];
  const { risk } = header.override;

  // ⌘B / Ctrl+B toggles the rail, except while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "b" &&
        !isEditable(event.target)
      ) {
        event.preventDefault();
        onCollapsedChange(!collapsed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, onCollapsedChange]);

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
          "hidden flex-none flex-col overflow-hidden transition-[width] duration-200 ease-out min-[820px]:flex",
          collapsed
            ? "w-[60px] items-center px-2.5 pt-3 pb-3"
            : "w-[244px] gap-2.5 px-2.5 pt-3.5 pb-3"
        )}
        data-collapsed={collapsed}
      >
        {collapsed ? (
          <Rail
            activeHref={activeHref}
            brand={brand}
            groups={navGroups}
            linkComponent={linkComponent}
            onExpand={() => onCollapsedChange(false)}
            onSearch={onSearch}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 px-1.5 pb-1.5">
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 py-0.5 text-brand-ink">
                <BrandLogo height={17} label={brand.name} />
                <div className="font-medium text-[10.5px] text-faint tabular-nums leading-[14px]">
                  {brand.meta}
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-keyshortcuts="Meta+B"
                      aria-label="Collapse navigation"
                      className="grid size-7 place-items-center rounded-md text-sidebar-muted outline-none hover:bg-sidebar-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                      onClick={() => onCollapsedChange(true)}
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  <PanelLeft className="size-4" />
                </TooltipTrigger>
                <TooltipContent
                  className={TIP_CLASS}
                  side="right"
                  sideOffset={8}
                >
                  Collapse navigation
                  <Keys keys={["⌘", "B"]} />
                </TooltipContent>
              </Tooltip>
            </div>

            <Button
              aria-keyshortcuts="Meta+K"
              className="mx-0.5 mb-1.5 flex h-8 items-center gap-2 rounded-[7px] bg-sidebar-field px-2.5 text-[13px] text-faint shadow-[0_0_0_1px_var(--border)] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              onClick={onSearch}
              title="Search or jump to…"
              type="button"
              variant="ghost"
            >
              <Search className="size-[14px] shrink-0" />
              <span className="flex-1 text-left">Search</span>
              <kbd className="rounded bg-sunken px-[5px] py-px font-medium text-[10.5px] text-muted-foreground leading-[14px] shadow-[0_0_0_1px_var(--border)]">
                ⌘K
              </kbd>
            </Button>

            <NavList
              activeHref={activeHref}
              groups={navGroups}
              linkComponent={linkComponent}
            />
          </>
        )}

        <div
          className={cn(
            "mt-auto flex flex-col gap-1 pt-3",
            collapsed && "w-10 items-center"
          )}
        >
          {organization}
          {account}
        </div>
      </aside>

      <header className="flex h-[52px] flex-none items-center gap-2.5 px-3 min-[820px]:hidden">
        <Button
          aria-label="Open navigation"
          className="grid size-9 place-items-center rounded-lg text-sidebar-foreground"
          onClick={() => setSheetOpen(true)}
          type="button"
          variant="ghost"
        >
          <Menu className="size-[18px]" />
        </Button>
        <span className="text-brand-ink">
          <BrandMark size={26} />
        </span>
        <div className="flex-1 truncate font-semibold text-sm">{pageTitle}</div>
        <Button
          aria-label="Search or jump to…"
          className="grid size-9 place-items-center rounded-lg text-sidebar-foreground"
          onClick={onSearch}
          type="button"
          variant="ghost"
        >
          <Search className="size-[17px]" />
        </Button>
      </header>

      <Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
        <SheetContent
          className="w-[300px] gap-3 rounded-r-[20px] bg-sidebar px-3 py-4 text-sidebar-foreground"
          showCloseButton={false}
          side="left"
        >
          <div className="flex items-center gap-2 px-1.5 text-brand-ink">
            <BrandLogo height={17} />
            <SheetTitle className="sr-only">{brand.name}</SheetTitle>
            <span className="flex-1" />
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
          <NavList
            activeHref={activeHref}
            groups={navGroups}
            linkComponent={linkComponent}
            mobile
            onNavigate={() => setSheetOpen(false)}
          />
          <div className="flex flex-col gap-1">
            {organization}
            {account}
          </div>
        </SheetContent>
      </Sheet>

      <main
        className="flex min-h-0 min-w-0 flex-1 px-2 pb-2 min-[820px]:pt-2 min-[820px]:pl-0"
        id="main-content"
      >
        <div
          className={cn(
            "relative flex min-w-0 flex-1 flex-col overflow-auto rounded-panel bg-card text-foreground shadow-panel",
            risk === "production" &&
              "shadow-[0_0_0_1px_var(--prod-line),0_0_0_4px_var(--prod-soft),0_12px_32px_-18px_rgba(201,58,44,0.25)]"
          )}
          data-risk={risk}
        >
          <ShellHeaderProvider value={header.slots}>
            <div className="sticky top-0 z-20 flex-none bg-card">
              <header
                className={cn(
                  "flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 border-border border-b py-2 pr-4 pl-5",
                  risk === "production" && "border-prod-line bg-prod-soft"
                )}
              >
                <div
                  className="flex min-w-0 flex-1 items-center gap-4 self-stretch"
                  ref={header.refs.setLead}
                >
                  {header.override.crumbs ? null : (
                    <Crumbs items={defaultCrumbs} />
                  )}
                </div>
                <div
                  className="flex flex-none flex-wrap items-center gap-2 empty:hidden"
                  ref={header.refs.setTrail}
                />
              </header>
              <div className="empty:hidden" ref={header.refs.setBelow} />
            </div>
            {children}
          </ShellHeaderProvider>
        </div>
      </main>
    </div>
  );
};
