"use client";

import { editor as monacoEditor, Uri } from "monaco-editor";
import { useEffect, useRef } from "react";
import { languageOf, setupMonaco } from "./monaco-setup";

export interface CodeEditorProps {
  /** Path of the file shown in the editor. */
  activePath: string;
  /** Every file of the function, so imports between them resolve. */
  files: readonly { content: string; path: string }[];
  /** Keeps models of different functions apart. */
  modelScope: string;
  onChange: (path: string, content: string) => void;
  readOnly: boolean;
  /**
   * Changes when the files were reloaded from the server. Only then are
   * open files overwritten; otherwise the editor's own text is the latest,
   * since `files` can trail behind fast typing by a render.
   */
  revision: number;
}

const uriOf = (scope: string, path: string) =>
  Uri.from({ path: `/${scope}/${path}`, scheme: "file" });

/**
 * A Monaco editor holding one model per file. Models live as long as the
 * editor, so switching tabs keeps each file's undo history and cursor.
 */
export default function CodeEditor({
  activePath,
  files,
  modelScope,
  onChange,
  readOnly,
  revision,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef(new Map<string, monacoEditor.ITextModel>());
  const viewStatesRef = useRef(
    new Map<string, monacoEditor.ICodeEditorViewState | null>()
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const shownPathRef = useRef<string | null>(null);
  const revisionRef = useRef(revision);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    setupMonaco();
    const editor = monacoEditor.create(container, {
      automaticLayout: true,
      fixedOverflowWidgets: true,
      fontSize: 13,
      minimap: { enabled: false },
      model: null,
      scrollBeyondLastLine: false,
      tabSize: 2,
      theme: "vs",
    });
    editorRef.current = editor;
    const models = modelsRef.current;
    const viewStates = viewStatesRef.current;
    return () => {
      editor.dispose();
      for (const model of models.values()) {
        model.dispose();
      }
      models.clear();
      viewStates.clear();
      editorRef.current = null;
      shownPathRef.current = null;
    };
  }, []);

  // Keep one model per file in step with the files passed in.
  useEffect(() => {
    if (!editorRef.current) {
      return;
    }
    const reloaded = revisionRef.current !== revision;
    revisionRef.current = revision;
    const models = modelsRef.current;
    const wanted = new Set(files.map((file) => file.path));
    for (const [path, model] of models) {
      if (!wanted.has(path)) {
        model.dispose();
        models.delete(path);
        viewStatesRef.current.delete(path);
      }
    }
    for (const file of files) {
      const existing = models.get(file.path);
      if (existing) {
        if (reloaded && existing.getValue() !== file.content) {
          existing.pushEditOperations(
            [],
            [{ range: existing.getFullModelRange(), text: file.content }],
            () => null
          );
        }
        continue;
      }
      const model = monacoEditor.createModel(
        file.content,
        languageOf(file.path),
        uriOf(modelScope, file.path)
      );
      model.onDidChangeContent(() => {
        onChangeRef.current(file.path, model.getValue());
      });
      models.set(file.path, model);
    }
  }, [files, modelScope, revision]);

  // Show the active file, remembering where the user was in the last one.
  useEffect(() => {
    const editor = editorRef.current;
    const model = modelsRef.current.get(activePath);
    if (!(editor && model) || shownPathRef.current === activePath) {
      return;
    }
    if (shownPathRef.current) {
      viewStatesRef.current.set(shownPathRef.current, editor.saveViewState());
    }
    editor.setModel(model);
    const viewState = viewStatesRef.current.get(activePath);
    if (viewState) {
      editor.restoreViewState(viewState);
    }
    shownPathRef.current = activePath;
    editor.focus();
  }, [activePath]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  return (
    <div
      className="h-full min-h-0 w-full"
      data-testid="code-editor"
      ref={containerRef}
    />
  );
}
