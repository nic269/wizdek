"use client";

import type { NodeType } from "./use-flow-editor";

/** Carries the node type while a palette entry is dragged onto the canvas. */
export const PALETTE_DRAG_TYPE = "application/x-flow-node-type";

const CATEGORIES = [
  { id: "trigger", label: "Triggers" },
  { id: "data", label: "Data" },
  { id: "logic", label: "Logic" },
  { id: "action", label: "Actions" },
] as const;

export function NodePalette({
  nodeTypes,
  onAdd,
}: {
  nodeTypes: NodeType[];
  /** Adds the node at the centre of the visible canvas. */
  onAdd: (nodeType: string) => void;
}) {
  return (
    <aside aria-label="Node palette" className="space-y-4 overflow-y-auto p-3">
      {CATEGORIES.map((category) => {
        const entries = nodeTypes.filter(
          (nodeType) => nodeType.category === category.id
        );
        if (entries.length === 0) {
          return null;
        }
        return (
          <section className="space-y-1" key={category.id}>
            <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {category.label}
            </h2>
            {entries.map((nodeType) => (
              <button
                aria-label={`Add ${nodeType.label}`}
                className="w-full cursor-grab rounded-md border bg-background px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                draggable
                key={nodeType.type}
                onClick={() => onAdd(nodeType.type)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(PALETTE_DRAG_TYPE, nodeType.type);
                  event.dataTransfer.effectAllowed = "move";
                }}
                title={nodeType.description}
                type="button"
              >
                <span className="block font-medium text-sm">
                  {nodeType.label}
                </span>
                <span className="line-clamp-2 block text-muted-foreground text-xs">
                  {nodeType.description}
                </span>
              </button>
            ))}
          </section>
        );
      })}
    </aside>
  );
}
