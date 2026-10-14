"use client";

import { useMonaco } from "@graphiql/react";
import { useEffect } from "react";

export const EDITOR_THEME = "wizdek-light";

/*
 * The wizdek syntax colours, as hex for Monaco: keywords violet, operation
 * names blue, variables red-orange, types teal, strings green, punctuation
 * grey. Defined once Monaco has loaded, then applied.
 */
const THEME = {
  base: "vs" as const,
  colors: {
    "editor.background": "#ffffff00",
    "editor.lineHighlightBackground": "#f8f8f6",
    "editorLineNumber.foreground": "#93938b",
    "editorSuggestWidget.selectedBackground": "#eef0fb",
    "editorSuggestWidget.selectedForeground": "#3a479b",
    focusBorder: "#4553b3",
    "list.highlightForeground": "#3a479b",
    "list.hoverBackground": "#f3f3f0",
    "scrollbar.shadow": "#ffffff00",
  },
  inherit: true,
  rules: [
    { foreground: "7d3fc0", token: "keyword" },
    { foreground: "2d5fa8", token: "identifier" },
    { foreground: "33332f", token: "key.identifier" },
    { foreground: "b3472f", token: "argument.identifier.gql" },
    { foreground: "b3472f", token: "variable" },
    { foreground: "18797f", token: "type.identifier" },
    { foreground: "2c7a45", token: "string" },
    { foreground: "2e66b8", token: "number" },
    { foreground: "9a9a92", token: "delimiter" },
    { fontStyle: "italic", foreground: "93938b", token: "comment" },
    { foreground: "3f4fa6", token: "string.key.json" },
    { foreground: "2c7a45", token: "string.value.json" },
    { foreground: "2e66b8", token: "number.json" },
    { foreground: "7d3fc0", token: "keyword.json" },
    { foreground: "9a9a92", token: "delimiter.bracket.json" },
  ],
};

/** Defines and applies the wizdek editor theme once Monaco is ready. */
export function WizdekEditorTheme() {
  const monaco = useMonaco((state) => state.monaco);
  useEffect(() => {
    if (!monaco) {
      return;
    }
    monaco.editor.defineTheme(EDITOR_THEME, THEME);
    monaco.editor.setTheme(EDITOR_THEME);
  }, [monaco]);
  return null;
}
