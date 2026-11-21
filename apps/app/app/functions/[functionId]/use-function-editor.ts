"use client";

import {
  apiClient,
  getApiErrorCode,
  getApiErrorMessage,
} from "@repo/api/client";
import {
  entryFileOf,
  filesProblem,
  isSafeRelativePath,
} from "@repo/functions/definition";
import { useCallback, useEffect, useMemo, useState } from "react";

export type CodeFunction = Awaited<
  ReturnType<typeof apiClient.functions.get>
>["data"];
export type FunctionFile = CodeFunction["files"][number];
export type FunctionSettings = Parameters<typeof apiClient.functions.update>[0];

const PACKAGES_POLL_MS = 2000;

const byPath = (a: FunctionFile, b: FunctionFile) =>
  a.path.localeCompare(b.path);

const contentByPath = (files: readonly FunctionFile[]) =>
  new Map(files.map((file) => [file.path, file.content]));

/** Why a new or renamed path cannot be used, or nothing when it can. */
export const pathProblem = (
  path: string,
  existing: readonly FunctionFile[]
): string | undefined => {
  if (!isSafeRelativePath(path)) {
    return 'Use letters, digits, ".", "-" and "_", with folders separated by "/".';
  }
  if (existing.some((file) => file.path === path)) {
    return `"${path}" already exists.`;
  }
};

/**
 * Holds the function being edited. Files are edited as drafts in memory;
 * nothing reaches the server or browser storage until the user saves.
 */
export const useFunctionEditor = (functionId: string) => {
  const [fn, setFn] = useState<CodeFunction | null>(null);
  const [saved, setSaved] = useState<FunctionFile[]>([]);
  const [drafts, setDrafts] = useState<FunctionFile[]>([]);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const [isReinstalling, setIsReinstalling] = useState(false);
  /**
   * Counts loads from the server. The editor owns the text while it is open
   * and takes file contents from here only when this changes.
   */
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    const { data } = await apiClient.functions.get({ functionId });
    const files = [...data.files].sort(byPath);
    const entry =
      entryFileOf(
        data.runtime,
        files.map((file) => file.path)
      ) ?? files[0]?.path;
    setFn(data);
    setSaved(files);
    setDrafts(files);
    setOpenPaths(entry ? [entry] : []);
    setActivePath(entry ?? null);
    setRevision((current) => current + 1);
    setHasConflict(false);
    setError(null);
  }, [functionId]);

  useEffect(() => {
    load().catch((cause: unknown) =>
      setLoadError(getApiErrorMessage(cause, "Could not load the function."))
    );
  }, [load]);

  const entryPath = useMemo(
    () =>
      fn
        ? (entryFileOf(
            fn.runtime,
            drafts.map((file) => file.path)
          ) ?? null)
        : null,
    [drafts, fn]
  );

  const dirtyPaths = useMemo(() => {
    const savedContent = contentByPath(saved);
    return new Set(
      drafts
        .filter((file) => savedContent.get(file.path) !== file.content)
        .map((file) => file.path)
    );
  }, [drafts, saved]);
  const isDirty =
    dirtyPaths.size > 0 ||
    saved.length !== drafts.length ||
    saved.some((file) => !drafts.some((draft) => draft.path === file.path));

  const open = useCallback((path: string) => {
    setOpenPaths((current) =>
      current.includes(path) ? current : [...current, path]
    );
    setActivePath(path);
  }, []);

  const close = useCallback(
    (path: string) => {
      const next = openPaths.filter((candidate) => candidate !== path);
      if (activePath === path) {
        const index = openPaths.indexOf(path);
        setActivePath(next[Math.min(index, next.length - 1)] ?? null);
      }
      setOpenPaths(next);
    },
    [activePath, openPaths]
  );

  const updateFile = useCallback((path: string, content: string) => {
    setDrafts((current) =>
      current.map((file) =>
        file.path === path && file.content !== content
          ? { ...file, content }
          : file
      )
    );
  }, []);

  const addFile = useCallback(
    (path: string) => {
      setDrafts((current) => [...current, { content: "", path }].sort(byPath));
      open(path);
    },
    [open]
  );

  const renameFile = useCallback((from: string, to: string) => {
    setDrafts((current) =>
      current
        .map((file) => (file.path === from ? { ...file, path: to } : file))
        .sort(byPath)
    );
    setOpenPaths((current) =>
      current.map((path) => (path === from ? to : path))
    );
    setActivePath((current) => (current === from ? to : current));
  }, []);

  /** Removes a file and returns it, so the caller can offer to undo. */
  const deleteFile = useCallback(
    (path: string) => {
      const removed = drafts.find((file) => file.path === path);
      setDrafts((current) => current.filter((file) => file.path !== path));
      close(path);
      return removed;
    },
    [close, drafts]
  );

  const restoreFile = useCallback(
    (file: FunctionFile) => {
      setDrafts((current) =>
        current.some((candidate) => candidate.path === file.path)
          ? current
          : [...current, file].sort(byPath)
      );
      open(file.path);
    },
    [open]
  );

  const save = useCallback(async () => {
    if (!fn) {
      return false;
    }
    setError(null);
    const problem = filesProblem(drafts);
    if (problem) {
      setError(problem);
      return false;
    }
    setIsSaving(true);
    try {
      const { data } = await apiClient.functions.saveFiles({
        baseHash: fn.sourceHash,
        files: drafts,
        functionId,
      });
      // Drafts stay as they are: anything typed while saving is kept, and
      // shows as unsaved against what the server now holds.
      setFn(data);
      setSaved([...data.files].sort(byPath));
      return true;
    } catch (cause) {
      if (getApiErrorCode(cause) === "CONFLICT") {
        // Local edits stay in the editor until the user chooses to reload.
        setHasConflict(true);
      } else {
        setError(getApiErrorMessage(cause, "Could not save the files."));
      }
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [drafts, fn, functionId]);

  /** Takes the package fields from the server, leaving files alone. */
  const applyPackages = useCallback((data: CodeFunction) => {
    setFn((current) =>
      current
        ? {
            ...current,
            depsBuiltAt: data.depsBuiltAt,
            depsError: data.depsError,
            depsLog: data.depsLog,
            depsStatus: data.depsStatus,
          }
        : current
    );
  }, []);

  // While packages install, check on them until they finish.
  const depsStatus = fn?.depsStatus;
  useEffect(() => {
    if (depsStatus !== "BUILDING") {
      return;
    }
    const timer = setInterval(() => {
      apiClient.functions
        .get({ functionId })
        .then(({ data }) => applyPackages(data))
        .catch(() => undefined);
    }, PACKAGES_POLL_MS);
    return () => clearInterval(timer);
  }, [applyPackages, depsStatus, functionId]);

  const reinstallPackages = useCallback(async () => {
    setIsReinstalling(true);
    try {
      const { data } = await apiClient.functions.reinstallDeps({ functionId });
      applyPackages(data);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not install the packages."));
    } finally {
      setIsReinstalling(false);
    }
  }, [applyPackages, functionId]);

  const updateSettings = useCallback(
    async (settings: Omit<FunctionSettings, "functionId">) => {
      const { data } = await apiClient.functions.update({
        ...settings,
        functionId,
      });
      // Settings never change the files, so drafts stay as they are.
      setFn((current) =>
        current ? { ...data, sourceHash: current.sourceHash } : data
      );
    },
    [functionId]
  );

  return {
    activePath,
    addFile,
    close,
    deleteFile,
    dirtyPaths,
    dismissConflict: () => setHasConflict(false),
    drafts,
    entryPath,
    error,
    fn,
    hasConflict,
    isDirty,
    isReinstalling,
    isSaving,
    loadError,
    open,
    openPaths,
    reinstallPackages,
    reload: load,
    renameFile,
    restoreFile,
    revision,
    save,
    updateFile,
    updateSettings,
  };
};

export type FunctionEditor = ReturnType<typeof useFunctionEditor>;
