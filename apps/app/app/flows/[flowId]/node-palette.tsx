"use client";

import { Button, Input, Search } from "@repo/design-system";
import { useState } from "react";
import {
  asCategory,
  CATEGORY_GROUPS,
  CATEGORY_HUES,
  CategoryChip,
} from "../node-visuals";
import type { NodeType } from "./use-flow-editor";

/** Carries the node type while a palette entry is dragged onto the canvas. */
export const PALETTE_DRAG_TYPE = "application/x-flow-node-type";

export function NodePalette({
  nodeTypes,
  onAdd,
}: {
  nodeTypes: NodeType[];
  /** Adds the node to the right of the existing steps. */
  onAdd: (nodeType: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = nodeTypes.filter(
    (nodeType) =>
      !needle ||
      nodeType.label.toLowerCase().includes(needle) ||
      nodeType.description.toLowerCase().includes(needle)
  );

  return (
    <aside
      aria-label="Node palette"
      className="flex min-h-0 w-[236px] flex-none flex-col border-border border-r"
    >
      <div className="relative p-3">
        <Search className="pointer-events-none absolute top-[21px] left-[21px] size-3.5 text-muted-foreground" />
        <Input
          aria-label="Add a step"
          className="h-8 pl-[30px] text-[13px]"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Add a step…"
          type="search"
          value={query}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {CATEGORY_GROUPS.map((group) => {
          const entries = matches.filter(
            (nodeType) => asCategory(nodeType.category) === group.id
          );
          if (entries.length === 0) {
            return null;
          }
          return (
            <section key={group.id}>
              <h2 className="font-(family-name:--label-font) text-(length:--label-size) flex items-center gap-[7px] px-1.5 pt-3 pb-1.5 font-medium text-muted-foreground leading-none tracking-(--label-tracking) [text-transform:var(--label-transform)]">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-[2px]"
                  style={{
                    background: `oklch(0.5 0.14 ${CATEGORY_HUES[group.id]})`,
                  }}
                />
                {group.label}
              </h2>
              {entries.map((nodeType) => (
                <Button
                  aria-label={`Add ${nodeType.label}`}
                  className="h-auto w-full cursor-grab items-start justify-start gap-[9px] whitespace-normal rounded-[7px] px-1.5 py-[7px] text-left font-normal"
                  draggable
                  key={nodeType.type}
                  onClick={() => onAdd(nodeType.type)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      PALETTE_DRAG_TYPE,
                      nodeType.type
                    );
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  title={nodeType.description}
                  type="button"
                  variant="ghost"
                >
                  <CategoryChip
                    category={group.id}
                    nodeType={nodeType.type}
                    size={26}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-[13px] leading-[1.25]">
                      {nodeType.label}
                    </span>
                    <span className="line-clamp-2 block text-[11.5px] text-muted-foreground leading-[1.35]">
                      {nodeType.description}
                    </span>
                  </span>
                </Button>
              ))}
            </section>
          );
        })}
        {matches.length === 0 ? (
          <p className="px-1.5 py-6 text-center text-muted-foreground text-xs">
            No step matches “{query}”.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
