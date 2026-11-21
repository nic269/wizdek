"use client";

import {
  Button,
  InlineAlert,
  LoaderCircle,
  RefreshCw,
} from "@repo/design-system";
import { DEPS_MANIFESTS } from "@repo/functions/definition";
import { formatRelative } from "../../lib/format";
import type { CodeFunction } from "./use-function-editor";

const InstallLog = ({ log, open }: { log: string; open?: boolean }) =>
  log ? (
    <details className="text-[12px]" open={open}>
      <summary className="cursor-pointer text-muted-foreground">
        Install log
      </summary>
      <pre
        className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-sunken p-2 font-mono text-[11.5px] leading-[1.45]"
        data-testid="packages-log"
      >
        {log}
      </pre>
    </details>
  ) : null;

/**
 * How the function's packages stand: installing, installed, or failed with
 * the end of the install's output. Shown only when the function has a
 * manifest.
 */
export function PackagesStatus({
  canManage,
  fn,
  isReinstalling,
  onReinstall,
}: {
  canManage: boolean;
  fn: CodeFunction;
  isReinstalling: boolean;
  onReinstall: () => void;
}) {
  const [manifest] = DEPS_MANIFESTS[fn.runtime];
  const reinstall = canManage ? (
    <Button
      disabled={isReinstalling || fn.depsStatus === "BUILDING"}
      onClick={onReinstall}
      size="sm"
      type="button"
      variant="outline"
    >
      <RefreshCw className="size-3" />
      Install again
    </Button>
  ) : null;

  if (fn.depsStatus === "BUILDING") {
    return (
      <InlineAlert
        icon={<LoaderCircle className="size-4 animate-spin" />}
        title="Installing packages…"
        tone="info"
      >
        From <code className="font-mono">{manifest}</code>. Runs can start once
        they are installed.
      </InlineAlert>
    );
  }
  if (fn.depsStatus === "FAILED") {
    return (
      <div className="space-y-2">
        <InlineAlert
          action={reinstall}
          title="The packages failed to install."
          tone="danger"
        >
          {fn.depsError ?? `Check ${manifest}.`} Runs are paused until they
          install.
        </InlineAlert>
        <InstallLog log={fn.depsLog} open />
      </div>
    );
  }
  if (fn.depsStatus === "READY") {
    return (
      <div className="space-y-1.5" data-testid="packages-ready">
        <div className="flex items-center justify-between gap-2 text-[12.5px]">
          <span className="text-foreground-2">
            Packages installed from{" "}
            <code className="font-mono">{manifest}</code>
            {fn.depsBuiltAt ? (
              <span className="text-muted-foreground">
                {" "}
                · {formatRelative(fn.depsBuiltAt)}
              </span>
            ) : null}
          </span>
          {reinstall}
        </div>
        <InstallLog log={fn.depsLog} />
      </div>
    );
  }
  return null;
}
