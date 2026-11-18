"use client";

import {
  Button,
  cn,
  Ellipsis,
  FileCode,
  FilePlus,
  Input,
  PencilLine,
  Trash2,
  toast,
} from "@repo/design-system";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/design-system/components/ui/dropdown-menu";
import { type FormEvent, useState } from "react";
import { type FunctionEditor, pathProblem } from "./use-function-editor";

type TreeRow =
  | { depth: number; kind: "folder"; name: string; path: string }
  | { depth: number; kind: "file"; name: string; path: string };

interface Folder {
  files: string[];
  folders: Map<string, Folder>;
}

/** Folders first, then files, each level sorted by name. */
export const treeRows = (paths: readonly string[]): TreeRow[] => {
  const root: Folder = { files: [], folders: new Map() };
  for (const path of paths) {
    const segments = path.split("/");
    let folder = root;
    for (const segment of segments.slice(0, -1)) {
      let next = folder.folders.get(segment);
      if (!next) {
        next = { files: [], folders: new Map() };
        folder.folders.set(segment, next);
      }
      folder = next;
    }
    folder.files.push(path);
  }
  const rows: TreeRow[] = [];
  const walk = (folder: Folder, prefix: string, depth: number) => {
    for (const name of [...folder.folders.keys()].sort()) {
      const path = `${prefix}${name}`;
      rows.push({ depth, kind: "folder", name, path });
      walk(folder.folders.get(name) as Folder, `${path}/`, depth + 1);
    }
    for (const path of [...folder.files].sort()) {
      rows.push({
        depth,
        kind: "file",
        name: path.slice(prefix.length),
        path,
      });
    }
  };
  walk(root, "", 0);
  return rows;
};

const PathForm = ({
  initial,
  label,
  onCancel,
  onSubmit,
  validate,
}: {
  initial: string;
  label: string;
  onCancel: () => void;
  onSubmit: (path: string) => void;
  validate: (path: string) => string | undefined;
}) => {
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<string | undefined>();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = value.trim();
    const found = validate(path);
    if (found) {
      setProblem(found);
      return;
    }
    onSubmit(path);
  };
  return (
    <form className="space-y-1 px-2 py-1" onSubmit={submit}>
      <Input
        aria-label={label}
        autoFocus
        className="h-7 font-mono text-xs"
        onBlur={() => (value.trim() ? null : onCancel())}
        onChange={(event) => {
          setValue(event.target.value);
          setProblem(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onCancel();
          }
        }}
        placeholder="lib/helpers.ts"
        value={value}
      />
      {problem ? (
        <p className="text-destructive text-xs leading-snug">{problem}</p>
      ) : null}
    </form>
  );
};

const FileMenu = ({
  onDelete,
  onRename,
  path,
}: {
  onDelete: () => void;
  onRename: () => void;
  path: string;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          aria-label={`Actions for ${path}`}
          className="size-6 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100"
          size="icon-sm"
          variant="ghost"
        />
      }
    >
      <Ellipsis className="size-3.5" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-36">
      <DropdownMenuItem onClick={onRename}>
        <PencilLine />
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onDelete} variant="destructive">
        <Trash2 />
        Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

/** The function's files as a tree; editing is offered only to managers. */
export function FileTree({
  canManage,
  editor,
}: {
  canManage: boolean;
  editor: FunctionEditor;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const rows = treeRows(editor.drafts.map((file) => file.path));
  const others = (except: string) =>
    editor.drafts.filter((file) => file.path !== except);

  const remove = (path: string) => {
    const removed = editor.deleteFile(path);
    if (removed) {
      toast(`Deleted ${path}`, {
        action: { label: "Undo", onClick: () => editor.restoreFile(removed) },
        description: "Save to keep the change.",
      });
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-9 items-center justify-between border-border border-b pr-1.5 pl-3">
        <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
          Files
        </span>
        {canManage ? (
          <Button
            aria-label="New file"
            className="size-7 text-muted-foreground"
            onClick={() => setIsAdding(true)}
            size="icon-sm"
            title="New file"
            variant="ghost"
          >
            <FilePlus className="size-4" />
          </Button>
        ) : null}
      </div>
      <nav
        aria-label="Function files"
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {isAdding ? (
          <PathForm
            initial=""
            label="New file path"
            onCancel={() => setIsAdding(false)}
            onSubmit={(path) => {
              editor.addFile(path);
              setIsAdding(false);
            }}
            validate={(path) => pathProblem(path, editor.drafts)}
          />
        ) : null}
        {rows.map((row) => {
          const indent = { paddingLeft: `${12 + row.depth * 12}px` };
          if (row.kind === "folder") {
            return (
              <div
                className="flex h-7 items-center truncate text-[12.5px] text-muted-foreground"
                key={`folder:${row.path}`}
                style={indent}
              >
                {row.name}/
              </div>
            );
          }
          if (renaming === row.path) {
            return (
              <PathForm
                initial={row.path}
                key={row.path}
                label={`New path for ${row.path}`}
                onCancel={() => setRenaming(null)}
                onSubmit={(path) => {
                  if (path !== row.path) {
                    editor.renameFile(row.path, path);
                  }
                  setRenaming(null);
                }}
                validate={(path) =>
                  path === row.path
                    ? undefined
                    : pathProblem(path, others(row.path))
                }
              />
            );
          }
          const isEntry = row.path === editor.entryPath;
          const isActive = row.path === editor.activePath;
          return (
            <div
              className={cn(
                "group flex h-7 items-center gap-1 pr-1.5 text-[12.5px] hover:bg-hover",
                isActive && "bg-hover font-medium text-foreground"
              )}
              key={row.path}
              style={indent}
            >
              <button
                aria-current={isActive ? "true" : undefined}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline"
                data-testid={`file-${row.path}`}
                onClick={() => editor.open(row.path)}
                type="button"
              >
                <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{row.name}</span>
                {editor.dirtyPaths.has(row.path) ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-foreground-2"
                    />
                    <span className="sr-only">(unsaved)</span>
                  </>
                ) : null}
              </button>
              {isEntry ? (
                <span
                  className="text-[10.5px] text-faint"
                  title="The runtime starts from this file"
                >
                  entry
                </span>
              ) : null}
              {canManage && !isEntry ? (
                <FileMenu
                  onDelete={() => remove(row.path)}
                  onRename={() => setRenaming(row.path)}
                  path={row.path}
                />
              ) : null}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
