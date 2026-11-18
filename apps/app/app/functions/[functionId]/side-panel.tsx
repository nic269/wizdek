"use client";

import { NavTabs } from "@repo/design-system";
import type { ReactNode } from "react";

export type SidePanelTab = "test" | "output" | "history" | "settings";

const TABS: { key: SidePanelTab; label: string }[] = [
  { key: "test", label: "Test" },
  { key: "output", label: "Output" },
  { key: "history", label: "History" },
  { key: "settings", label: "Settings" },
];

/** The workbench's right-hand panel: one tab shown at a time. */
export function SidePanel({
  children,
  onTabChange,
  tab,
}: {
  children: ReactNode;
  onTabChange: (tab: SidePanelTab) => void;
  tab: SidePanelTab;
}) {
  return (
    <aside className="flex w-[320px] flex-none flex-col border-border border-l bg-card xl:w-[380px]">
      <NavTabs
        aria-label="Function panel"
        className="shrink-0 px-4"
        tabs={TABS.map(({ key, label }) => ({
          current: tab === key,
          key,
          label,
          onSelect: () => onTabChange(key),
        }))}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </aside>
  );
}
