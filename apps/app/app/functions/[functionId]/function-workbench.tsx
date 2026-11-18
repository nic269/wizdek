"use client";

import {
  Button,
  cn,
  ErrorAlert,
  Lock,
  Play,
  ShellHeader,
  Shimmer,
  Square,
  toast,
} from "@repo/design-system";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { RUNTIME_LABELS } from "@repo/functions/definition";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorTabs } from "./editor-tabs";
import { FileTree } from "./file-tree";
import { HistoryTab } from "./history-tab";
import { OutputTab } from "./output-tab";
import { SettingsTab } from "./settings-tab";
import { SidePanel, type SidePanelTab } from "./side-panel";
import { paramsToSend, TestTab } from "./test-tab";
import { type FunctionEditor, useFunctionEditor } from "./use-function-editor";
import { type FunctionRunState, useFunctionRun } from "./use-function-run";

// Monaco needs the browser.
const CodeEditor = dynamic(() => import("./code-editor"), {
  loading: () => <div className="h-full bg-card" />,
  ssr: false,
});

export interface FunctionWorkbenchProps {
  /** May edit and save; otherwise the editor is read-only. */
  canManage: boolean;
  canRun: boolean;
  functionId: string;
}

const WorkbenchSkeleton = () => (
  <div className="flex flex-1 flex-col" role="status">
    <span className="sr-only">Loading function</span>
    <div className="flex items-center gap-3 border-border border-b px-3.5 py-3.5">
      <Shimmer className="w-40" />
      <Shimmer className="w-20" />
    </div>
    <div className="flex-1 bg-sunken" />
  </div>
);

const ConflictDialog = ({ editor }: { editor: FunctionEditor }) => (
  <Dialog
    onOpenChange={(open) => {
      if (!open) {
        editor.dismissConflict();
      }
    }}
    open={editor.hasConflict}
  >
    <DialogContent className="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>These files were changed by someone else</DialogTitle>
        <DialogDescription>
          Newer files were saved while you were editing. Your changes are still
          in the editor. Reload to get the newer files and lose your changes, or
          keep editing and copy what you need first.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          onClick={editor.dismissConflict}
          type="button"
          variant="outline"
        >
          Keep editing
        </Button>
        <Button onClick={() => editor.reload()} type="button">
          Reload newer files
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

const HeaderActions = ({
  canManage,
  canRun,
  editor,
  onRun,
  onSave,
  run,
}: {
  canManage: boolean;
  canRun: boolean;
  editor: FunctionEditor;
  onRun: () => void;
  onSave: () => void;
  run: FunctionRunState;
}) => (
  <>
    {canManage ? (
      <Button
        aria-keyshortcuts="Meta+S"
        aria-label={editor.isSaving ? "Saving" : "Save"}
        className={cn(
          "h-8 text-[13px]",
          !editor.isDirty && "text-muted-foreground"
        )}
        disabled={editor.isSaving || !editor.isDirty}
        onClick={onSave}
        type="button"
        variant="outline"
      >
        {editor.isSaving ? "Saving…" : "Save"}
        <kbd className="font-medium text-[10.5px] text-muted-foreground tabular-nums">
          ⌘S
        </kbd>
      </Button>
    ) : null}
    {canRun && run.isActive ? (
      <Button
        className="h-8 text-[13px]"
        disabled={run.isCanceling || Boolean(run.run?.cancelRequestedAt)}
        onClick={run.cancel}
        type="button"
        variant="outline"
      >
        <Square className="size-3" />
        Cancel
      </Button>
    ) : null}
    {canRun && !run.isActive ? (
      <Button
        aria-keyshortcuts="Meta+Enter"
        className="h-8 text-[13px]"
        disabled={run.isStarting || editor.isSaving}
        onClick={onRun}
        type="button"
      >
        <Play className="size-[13px]" />
        Run
        <kbd className="font-medium text-[10.5px] opacity-70">⌘↵</kbd>
      </Button>
    ) : null}
  </>
);

export function FunctionWorkbench({
  canManage,
  canRun,
  functionId,
}: FunctionWorkbenchProps) {
  const editor = useFunctionEditor(functionId);
  const run = useFunctionRun(functionId);
  const [tab, setTab] = useState<SidePanelTab>("test");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const { fn, isDirty, save } = editor;

  // Closing or leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const saveFiles = useCallback(async () => {
    if (await save()) {
      toast.success("Saved");
    }
  }, [save]);

  // A run always uses the saved source, so unsaved edits are saved first.
  const startRun = useCallback(async () => {
    if (!fn || run.isStarting || run.isActive) {
      return;
    }
    if (isDirty && !(canManage && (await save()))) {
      return;
    }
    if (await run.start(paramsToSend(fn, values))) {
      setTab("output");
    } else {
      setTab("test");
    }
  }, [canManage, fn, isDirty, run, save, values]);

  // ⌘S saves and ⌘↵ runs, wherever the focus is. The listener runs before
  // Monaco's own key handling so ⌘↵ does not also insert a line.
  const shortcuts = useRef({ canManage, canRun, isDirty, saveFiles, startRun });
  shortcuts.current = { canManage, canRun, isDirty, saveFiles, startRun };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      const { current } = shortcuts;
      if (event.key.toLowerCase() === "s" && current.canManage) {
        event.preventDefault();
        event.stopPropagation();
        if (current.isDirty) {
          current.saveFiles();
        }
      } else if (event.key === "Enter" && current.canRun) {
        event.preventDefault();
        event.stopPropagation();
        current.startRun();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  if (editor.loadError) {
    return (
      <div className="p-6">
        <ErrorAlert
          message={editor.loadError}
          onRetry={() => editor.reload()}
          title="Couldn't load the function."
        />
      </div>
    );
  }
  if (!fn) {
    return <WorkbenchSkeleton />;
  }

  return (
    <div className="flex min-h-[640px] flex-1 flex-col">
      <ShellHeader
        actions={
          <HeaderActions
            canManage={canManage}
            canRun={canRun}
            editor={editor}
            onRun={startRun}
            onSave={saveFiles}
            run={run}
          />
        }
        crumbs={[
          { label: "Automation" },
          { href: "/functions", label: "Functions" },
          {
            label: (
              <h1 className="truncate font-[550] text-[13px] text-foreground">
                {fn.name}
              </h1>
            ),
          },
        ]}
        lead={
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-[22px] items-center rounded-full border border-input px-2 font-medium text-foreground-2 text-xs">
              {RUNTIME_LABELS[fn.runtime]}
            </span>
            {canManage ? null : (
              <span className="inline-flex h-[22px] items-center gap-[5px] rounded-full border border-input px-2 font-medium text-foreground-2 text-xs">
                <Lock className="size-[11px]" />
                Read-only
              </span>
            )}
          </div>
        }
        linkComponent={Link}
      />

      {editor.error ? (
        <ErrorAlert
          className="m-3 mb-0"
          message={editor.error}
          title="Not saved."
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[180px] flex-none flex-col border-border border-r bg-card xl:w-[220px]">
          <FileTree canManage={canManage} editor={editor} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <EditorTabs editor={editor} />
          <div className="min-h-0 flex-1">
            {editor.activePath ? (
              <CodeEditor
                activePath={editor.activePath}
                files={editor.drafts}
                modelScope={fn.id}
                onChange={editor.updateFile}
                readOnly={!canManage}
                revision={editor.revision}
              />
            ) : (
              <p className="p-6 text-[13px] text-muted-foreground">
                Choose a file to open it.
              </p>
            )}
          </div>
        </div>
        <SidePanel onTabChange={setTab} tab={tab}>
          {tab === "test" ? (
            <TestTab
              canRun={canRun}
              error={run.startError}
              fn={fn}
              isBusy={run.isStarting || run.isActive || editor.isSaving}
              isDirty={isDirty && canManage}
              onRun={startRun}
              onValuesChange={setValues}
              values={values}
            />
          ) : null}
          {tab === "output" ? <OutputTab canRun={canRun} state={run} /> : null}
          {tab === "history" ? (
            <HistoryTab
              functionId={fn.id}
              onSelect={(runId) => {
                run.select(runId);
                setTab("output");
              }}
              selectedRunId={run.runId}
            />
          ) : null}
          {tab === "settings" ? (
            <SettingsTab canManage={canManage} editor={editor} fn={fn} />
          ) : null}
        </SidePanel>
      </div>

      <ConflictDialog editor={editor} />
    </div>
  );
}
