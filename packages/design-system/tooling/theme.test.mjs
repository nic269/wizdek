import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";
import { themeFontFaces, themeFontImports } from "./theme-fonts.mjs";
import { mergeThemes, parseTheme } from "./theme-parser.mjs";
import themePlugin from "./theme-postcss.mjs";

const dirs = [];
const fontCss = `@font-face {font-family: Inter; font-style: normal; font-weight: 100 900; font-display: swap; src: url("https://fonts.gstatic.com/inter.woff2") format("woff2");}`;
const loadFontCss = () => Promise.resolve(fontCss);
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

const exportCss = `@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
:root { --primary: oklch(0.6 0.2 240); --font-sans: "Inter", sans-serif; --spacing: 0.375rem; --radius: 1rem; --shadow-sm: 0 2px 4px #0003; --tracking-normal: 0.02em; }
.dark { --primary: #00ff00; }
@theme inline { --color-primary: var(--primary); --font-sans: var(--font-sans); --radius-lg: var(--radius); --shadow-sm: var(--shadow-sm); }
@layer base { * { @apply border-border outline-ring/50; } body { @apply bg-background text-foreground; letter-spacing: var(--tracking-normal); } }`;

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "app-theme-test-"));
  dirs.push(dir);
  const from = path.join(dir, "styles.css");
  const themeFile = path.join(dir, "theme.tweakcn.css");
  await writeFile(themeFile, exportCss);
  return { from, themeFile };
}

describe("whole-file tweakcn ingestion", () => {
  it("extracts full v4 export without requiring manual scaffold removal", () => {
    const value = parseTheme(exportCss, "theme.css");
    expect(value.light["--primary"]).toBe("oklch(0.6 0.2 240)");
    expect(value.dark["--primary"]).toBe("#00ff00");
    expect(value.light["--shadow-sm"]).toBe("0 2px 4px #0003");
    expect(parseTheme("/* inherit */", "empty.css")).toEqual({
      dark: {},
      light: {},
    });
  });

  it.each([
    "@tailwind base;",
    ":root { --primary: 210 50% 40%; }",
    '@import "https://example.com/global.css";',
    ":root { --primary: red !important; }",
    ":root { --unknown-token: red; }",
    ".button { color: red; }",
    "@layer base { body { display: none; } }",
    ':root { --primary: url("https://example.com"); }',
    "@theme inline { --color-primary: red; }",
    "@theme inline { --color-custom: var(--custom); }",
  ])("rejects unsupported input with a source location: %s", (css) => {
    expect(() => parseTheme(css, "/theme.css")).toThrow("/theme.css:1:");
  });

  it("merges partial colors independently by mode and shares density/font settings", () => {
    const base = parseTheme(
      ":root { --primary: red; --spacing: 0.25rem; } .dark { --primary: pink; }"
    );
    const custom = parseTheme(":root { --primary: blue; --spacing: 0.5rem; }");
    const result = mergeThemes([base, custom]);
    expect(result.light["--primary"]).toBe("blue");
    expect(result.dark["--primary"]).toBe("pink");
    expect(result.dark["--spacing"]).toBe("0.5rem");
    expect(mergeThemes([base, parseTheme("")])).toEqual(mergeThemes([base]));
  });

  it("keeps explicit values even when equal to today's default", () => {
    const custom = parseTheme(":root { --primary: red; }");
    expect(
      mergeThemes([parseTheme(":root { --primary: blue; }"), custom]).light[
        "--primary"
      ]
    ).toBe("red");
  });

  it("preserves extension defaults when a whole export is the sole theme input", async () => {
    const { from, themeFile } = await fixture();
    const processor = postcss([themePlugin({ loadFontCss })]);
    const input = '@app-theme "./theme.tweakcn.css";';
    const compiled = await processor.process(input, { from });
    const result = { dark: {}, light: {} };
    compiled.root.walkRules((rule) => {
      const mode = rule.selector === ":root.dark" ? "dark" : "light";
      rule.walkDecls((decl) => {
        result[mode][decl.prop] = decl.value;
      });
    });
    for (const mode of ["light", "dark"]) {
      expect(result[mode]["--success"]).toBe("oklch(50.8% 0.118 165.612)");
      expect(result[mode]["--destructive-foreground"]).toBe("oklch(0.985 0 0)");
    }
    await writeFile(
      themeFile,
      ":root { --success: green; } .dark { --success: lime; }"
    );
    const custom = (await processor.process(input, { from })).css;
    expect(custom).toContain("--success: green");
    expect(custom).toContain("--success: lime");
  });

  it("registers dependencies, leaves input untouched, and reads changes without module reload", async () => {
    const { from, themeFile } = await fixture();
    const processor = postcss([themePlugin({ loadFontCss })]);
    const input = '@app-theme default; @app-theme "./theme.tweakcn.css";';
    const first = await processor.process(input, { from });
    expect(first.messages).toContainEqual(
      expect.objectContaining({
        file: themeFile,
        parent: from,
        type: "dependency",
      })
    );
    expect(first.css).not.toContain("@theme inline");
    expect(first.css).not.toContain('import "tailwindcss"');
    expect(first.css).toContain("fonts.gstatic.com/inter.woff2");
    expect(await readFile(themeFile, "utf8")).toBe(exportCss);
    await writeFile(themeFile, ":root { --primary: #abcdef; }");
    const second = await processor.process(input, { from });
    expect(second.css).toContain("--primary: #abcdef");
    expect(second.css).not.toContain("fonts.googleapis.com");
  });

  it("compiles normalized exports through Tailwind and invalidates its incremental cache", async () => {
    const { from, themeFile } = await fixture();
    const twFile = path.resolve("node_modules/tailwindcss/index.css");
    const contract = path.resolve("src/styles/theme-contract.css");
    const input = `@import "${twFile}" source(none); @import "${contract}"; @app-theme default; @app-theme "./theme.tweakcn.css"; @source inline("bg-primary p-4 rounded-lg shadow-sm font-sans tracking-normal");`;
    const processor = postcss([
      themePlugin({ loadFontCss }),
      tailwind({ optimize: true }),
    ]);
    const result = await processor.process(input, { from });
    expect(result.css).toContain("var(--primary)");
    expect(result.css).toContain("var(--spacing)");
    expect(result.css).toContain("var(--radius)");
    expect(result.css).not.toContain("app-theme");
    const imported = postcss
      .parse(result.css)
      .nodes.filter((node) => node.type === "atrule" && node.name === "import");
    expect(imported).toHaveLength(0);
    expect(result.css).toContain("@font-face");
    await writeFile(themeFile, ":root { --primary: #abcdef; }");
    const next = await processor.process(input, { from });
    expect(next.css).toContain("#abcdef");
    expect(next.css).not.toContain("fonts.googleapis.com");
  });
});

describe("automatic fonts", () => {
  it("emits font faces, not fragile runtime stylesheet imports", async () => {
    const faces = await themeFontFaces(
      { light: { "--font-sans": "Inter, sans-serif" } },
      [],
      loadFontCss
    );
    expect(faces).toHaveLength(1);
    expect(faces[0].name).toBe("font-face");
    expect(faces[0].toString()).toContain("fonts.gstatic.com");
  });
  it("reports font network failures without silently accepting a fallback", async () => {
    await expect(
      themeFontFaces(
        { light: { "--font-sans": "Inter, sans-serif" } },
        [],
        () => Promise.reject(new Error("offline"))
      )
    ).rejects.toThrow("Could not load theme font metadata");
  });
  it("rejects non-font styles from the font provider", async () => {
    await expect(
      themeFontFaces(
        { light: { "--font-sans": "Inter, sans-serif" } },
        [],
        () => Promise.resolve("body { display: none }")
      )
    ).rejects.toThrow("Unexpected Google Fonts stylesheet content");
  });
  it("does not request a nonexistent normal style for italic-only families", () => {
    const result = themeFontImports({
      light: { "--font-sans": "Molle, cursive" },
    });
    expect(result[0].params).toContain("Molle:ital,wght@1,400");
  });
  it("deduplicates selected fonts, resolves family case, and includes italic/variable axes", () => {
    const result = themeFontImports({
      dark: { "--font-mono": "Inter, monospace" },
      light: { "--font-sans": '"inter", sans-serif' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].params).toContain(
      "Inter:ital,wght@0,100..900;1,100..900&display=swap"
    );
    expect(result[0].params).not.toContain("subset=");
  });
  it("does not fetch bundled/system/custom registered fonts", () => {
    expect(
      themeFontImports(
        {
          light: {
            "--font-mono": "PrivateFont, monospace",
            "--font-sans": '"Albert Sans", sans-serif',
            "--font-serif": "Georgia, serif",
          },
        },
        ["PrivateFont"]
      )
    ).toEqual([]);
  });
  it("rejects unknown primary fonts rather than silently using a fallback", () => {
    expect(() =>
      themeFontImports({ light: { "--font-sans": "MissingFont, sans-serif" } })
    ).toThrow('Unknown theme font "MissingFont"');
  });
  it("respects a family's actual weight range and styles", () => {
    const result = themeFontImports({
      light: { "--font-sans": "Bebas Neue, sans-serif" },
    });
    expect(result[0].params).toContain("Bebas%20Neue:wght@400");
    expect(result[0].params).not.toContain("ital");
  });
});
