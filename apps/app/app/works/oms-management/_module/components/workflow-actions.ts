"use client";
import { useEffect, useRef, useState } from "react";
import type { TargetRef } from "../lib/contracts";
import { MANAGEMENT_ROOT } from "../lib/navigation";
import { request } from "./management-app";
import type { WorkflowLog, WorkflowRun } from "./workflow-types";

const FILENAME = /filename="([^"\r\n]+)"/;
async function copyBundle(
  target: TargetRef,
  runId: string,
  signal: AbortSignal
) {
  const params = new URLSearchParams({
    id: runId,
    profileId: target.profileId,
    resource: "log-bundle",
    revision: String(target.revision),
  });
  const result = await request<{
    target: TargetRef;
    data: { run: WorkflowRun & { logs: WorkflowLog[] } };
  }>(`diagnostics?${params}`, { signal });
  if (
    result.target.profileId !== target.profileId ||
    result.target.revision !== target.revision
  ) {
    throw new Error("The connection changed. Refresh this view.");
  }
  signal.throwIfAborted();
  await navigator.clipboard.writeText(JSON.stringify(result.data.run, null, 2));
  return "Debug bundle copied, including all log entries.";
}
async function downloadOriginal(
  target: TargetRef,
  runId: string,
  signal: AbortSignal
) {
  const params = new URLSearchParams({
    id: runId,
    profileId: target.profileId,
    revision: String(target.revision),
  });
  const response = await fetch(`${MANAGEMENT_ROOT}/api/import-file?${params}`, {
    cache: "no-store",
    signal,
  });
  if (response.status === 401) {
    window.dispatchEvent(new Event("oms-session-expired"));
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error?.message ?? "The original file could not be downloaded."
    );
  }
  const blob = await response.blob();
  signal.throwIfAborted();
  const filename =
    response.headers.get("content-disposition")?.match(FILENAME)?.[1] ??
    `import-${runId}.csv`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "Import file downloaded.";
}
export function useWorkflowActions(target: TargetRef, runId: string | null) {
  const controller = useRef<AbortController | null>(null);
  const [action, setAction] = useState<"copy" | "download" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // The detail component is keyed by target revision and run ID; abort when it is replaced.
  useEffect(() => () => controller.current?.abort(), []);
  const perform = async (kind: "copy" | "download") => {
    if (!runId) {
      return;
    }
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setAction(kind);
    setNotice("");
    setError("");
    try {
      const message = await (kind === "copy" ? copyBundle : downloadOriginal)(
        target,
        runId,
        current.signal
      );
      if (!current.signal.aborted) {
        setNotice(message);
      }
    } catch (failure) {
      if (!current.signal.aborted) {
        setError(
          failure instanceof Error
            ? failure.message
            : "The action could not be completed."
        );
      }
    } finally {
      if (!current.signal.aborted) {
        setAction(null);
      }
    }
  };
  return { action, error, notice, perform };
}
