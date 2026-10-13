import postcss from "postcss";
import catalog from "./google-fonts.json" with { type: "json" };

const local = new Set([
  "albert sans",
  "arial",
  "helvetica",
  "helvetica neue",
  "georgia",
  "times new roman",
  "courier new",
  "verdana",
  "tahoma",
  "trebuchet ms",
  "segoe ui",
  "sans-serif",
  "serif",
  "monospace",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "cursive",
  "fantasy",
  "-apple-system",
  "blinkmacsystemfont",
]);
const families = new Map(
  Object.keys(catalog).map((name) => [name.toLowerCase(), name])
);

export function themeFontImports(theme, registeredFonts = []) {
  const registered = new Set([
    ...local,
    ...registeredFonts.map((name) => name.toLowerCase()),
  ]);
  const selected = new Set();
  for (const mode of Object.values(theme)) {
    for (const slot of ["--font-sans", "--font-serif", "--font-mono"]) {
      const stack = mode[slot];
      if (!stack) {
        continue;
      }
      const first = postcss.list
        .comma(stack)[0]
        .trim()
        .replace(/^["']|["']$/g, "");
      if (registered.has(first.toLowerCase())) {
        continue;
      }
      const family = families.get(first.toLowerCase());
      if (!family) {
        throw new Error(
          `Unknown theme font "${first}". Register its @font-face and add its family to theme plugin registeredFonts, or choose a supported Google/system font.`
        );
      }
      selected.add(family);
    }
  }
  return [...selected].sort().map((family) => {
    const [weights, italic, normal = true] = catalog[family];
    const values = weights.split(";");
    const axes = italic
      ? `ital,wght@${(normal ? [0, 1] : [1]).flatMap((style) => values.map((weight) => `${style},${weight}`)).join(";")}`
      : `wght@${weights}`;
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${axes}&display=swap`;
    return postcss.atRule({ name: "import", params: `url("${url}")` });
  });
}

const fontCssCache = new Map();
const fontUrl = /^url\("(.+)"\)$/;

async function fetchFontCss(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Google Fonts returned ${response.status} for ${url}`);
  }
  return response.text();
}

export async function themeFontFaces(
  theme,
  registeredFonts,
  loadCss = fetchFontCss
) {
  const imports = themeFontImports(theme, registeredFonts);
  const blocks = await Promise.all(
    imports.map(async (node) => {
      const [, url] = fontUrl.exec(node.params);
      // Only cache real requests; injected loaders keep tests isolated.
      let pending =
        loadCss === fetchFontCss ? fontCssCache.get(url) : undefined;
      if (!pending) {
        pending = loadCss(url);
        if (loadCss === fetchFontCss) {
          fontCssCache.set(url, pending);
        }
      }
      try {
        const css = postcss.parse(await pending, { from: url });
        const faces = [];
        css.each((rule) => {
          if (rule.type === "comment") {
            return;
          }
          if (rule.type !== "atrule" || rule.name !== "font-face") {
            throw rule.error("Unexpected Google Fonts stylesheet content.");
          }
          faces.push(rule.clone());
        });
        if (faces.length === 0) {
          throw new Error(`No font faces returned for ${url}`);
        }
        return faces;
      } catch (error) {
        fontCssCache.delete(url);
        throw new Error(
          `Could not load theme font metadata. Check network access to Google Fonts or register a local font. ${error.message}`
        );
      }
    })
  );
  return blocks.flat();
}
