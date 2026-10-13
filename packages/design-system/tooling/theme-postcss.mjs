import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { themeFontFaces } from "./theme-fonts.mjs";
import { mergeThemes, parseTheme, themeRules } from "./theme-parser.mjs";

const defaultTheme = fileURLToPath(
  new URL("../src/styles/themes/default.tweakcn.css", import.meta.url)
);

// Required product roles absent from standard tweakcn exports stay available.
const extensionDefaults = parseTheme(`
:root {
  --success: oklch(50.8% 0.118 165.612);
  --destructive-foreground: oklch(0.985 0 0);
}
.dark {
  --success: oklch(50.8% 0.118 165.612);
  --destructive-foreground: oklch(0.985 0 0);
}
`);

const quotedPath = /^(["'])(.+)\1$/;

export default function themePlugin(options = {}) {
  return {
    async Once(root, { result }) {
      const inputs = [];
      root.walkAtRules("app-theme", (node) => inputs.push(node));
      if (inputs.length === 0) {
        return;
      }
      const themes = [extensionDefaults];
      for (const node of inputs) {
        const source = node.source?.input.file;
        if (!(source && node.parent === root)) {
          throw node.error(
            "Place @app-theme at the top level of the app stylesheet."
          );
        }
        const match = quotedPath.exec(node.params);
        if (node.params !== "default" && !match) {
          throw node.error(
            'Use @app-theme default or @app-theme "./theme.tweakcn.css".'
          );
        }
        const file =
          node.params === "default"
            ? defaultTheme
            : path.resolve(path.dirname(source), match[2]);
        result.messages.push({
          file,
          parent: source,
          plugin: "app-theme",
          type: "dependency",
        });
        themes.push(parseTheme(await readFile(file, "utf8"), file));
      }
      const theme = mergeThemes(themes);
      inputs.at(-1).replaceWith(...themeRules(theme));
      for (const input of inputs.slice(0, -1)) {
        input.remove();
      }
      // Emit font faces directly: bundlers can drop external CSS @imports
      // introduced by PostCSS. Font files still load lazily in the browser.
      const fonts = await themeFontFaces(
        theme,
        options.registeredFonts,
        options.loadFontCss
      );
      root.append(...fonts);
    },
    postcssPlugin: "app-theme",
  };
}

themePlugin.postcss = true;
