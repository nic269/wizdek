"use client";

import { Button, Input, Search } from "@repo/design-system";
import { useState } from "react";
import { asCategory, CATEGORY_GROUPS, CategoryChip } from "../node-visuals";
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
      className="flex min-h-0 w-[232px] flex-none flex-col border-border border-r"
    >
      <div className="relative p-3">
        <Search className="pointer-events-none absolute top-[21px] left-[21px] size-3.5 text-muted-foreground" />
        <Input
          aria-label="Add a step"
          className="h-8 pl-[30px] text-[13px]"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Add a node"
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
              <h2 className="font-(family-name:--label-font) text-(length:--label-size) px-1.5 pt-2.5 pb-1.5 font-medium text-faint leading-none tracking-(--label-tracking) [text-transform:var(--label-transform)]">
                {group.label}
              </h2>
              {entries.map((nodeType) => (
                <Button
                  aria-label={`Add ${nodeType.label}`}
                  className="h-8 w-full cursor-grab justify-start gap-2.5 rounded-md px-2 text-left font-normal text-[13px] text-foreground"
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
                    size={22}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {nodeType.label}
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
