"use client";

import { cn, X } from "@repo/design-system";
import type { FunctionEditor } from "./use-function-editor";

const fileName = (path: string) => path.split("/").pop() ?? path;

/** One tab per open file, with a dot while the file has unsaved changes. */
export function EditorTabs({ editor }: { editor: FunctionEditor }) {
  return (
    <div
      aria-label="Open files"
      className="flex h-9 shrink-0 overflow-x-auto border-border border-b bg-sunken"
      role="tablist"
    >
      {editor.openPaths.map((path) => {
        const isActive = path === editor.activePath;
        const isDirty = editor.dirtyPaths.has(path);
        return (
          <div
            className={cn(
              "group flex shrink-0 items-center border-border border-r text-[12.5px]",
              isActive
                ? "bg-card text-foreground shadow-[inset_0_-2px_0_var(--foreground)]"
                : "text-muted-foreground hover:text-foreground"
            )}
            key={path}
          >
            <button
              aria-selected={isActive}
              className="flex h-full items-center gap-1.5 pr-1 pl-3 outline-none focus-visible:underline"
              onClick={() => editor.open(path)}
              role="tab"
              title={path}
              type="button"
            >
              {fileName(path)}
              {isDirty ? (
                <>
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-foreground-2"
                  />
                  <span className="sr-only">(unsaved)</span>
                </>
              ) : null}
            </button>
            <button
              aria-label={`Close ${path}`}
              className="mr-1.5 grid size-5 place-items-center rounded text-muted-foreground opacity-0 hover:bg-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[active=true]:opacity-100"
              data-active={isActive}
              onClick={() => editor.close(path)}
              type="button"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
