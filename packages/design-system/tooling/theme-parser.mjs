import postcss from "postcss";

const colors = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  ...Array.from({ length: 5 }, (_, i) => `chart-${i + 1}`),
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
];
const dimensions = [
  "radius",
  "spacing",
  "tracking-normal",
  "font-sans",
  "font-serif",
  "font-mono",
];
const shadows = [
  "shadow",
  "shadow-2xs",
  "shadow-xs",
  "shadow-sm",
  "shadow-md",
  "shadow-lg",
  "shadow-xl",
  "shadow-2xl",
  "shadow-x",
  "shadow-y",
  "shadow-blur",
  "shadow-spread",
  "shadow-opacity",
  "shadow-color",
];
const supported = new Set(
  [...colors, ...dimensions, ...shadows].map((name) => `--${name}`)
);
const common = new Set([...dimensions, ...shadows].map((name) => `--${name}`));
const forbiddenValue = /(?:url\s*\(|expression\s*\(|[{};])/i;

const bareHsl = /^[-\d.]+\s+[-\d.]+%/;
const tailwindImport = /^(["'])tailwindcss\1$/;

function readDeclarations(rule, target) {
  rule.each((node) => {
    if (node.type === "comment") {
      return;
    }
    if (
      node.type !== "decl" ||
      !(supported.has(node.prop) || node.prop.startsWith("--app-"))
    ) {
      throw node.error(
        "Unsupported theme token. Use shadcn tokens or a --app- extension."
      );
    }
    if (
      node.important ||
      forbiddenValue.test(node.value) ||
      !node.value.trim()
    ) {
      throw node.error(
        "Theme values must be non-empty CSS values without !important or URLs."
      );
    }
    if (colors.includes(node.prop.slice(2)) && bareHsl.test(node.value)) {
      throw node.error(
        "Bare HSL channels are Tailwind v3 syntax. Export Tailwind v4 CSS from tweakcn."
      );
    }
    target[node.prop] = node.value;
  });
}

function checkBase(node) {
  node.each((rule) => {
    if (rule.type === "comment") {
      return;
    }
    if (rule.type !== "rule" || !["*", "body"].includes(rule.selector)) {
      throw rule.error(
        "Only tweakcn's standard base scaffold is supported in a theme file."
      );
    }
    rule.each((child) => {
      if (child.type === "comment") {
        return;
      }
      const apply =
        child.type === "atrule" &&
        child.name === "apply" &&
        (rule.selector === "*"
          ? ["border-border", "border-border outline-ring/50"].includes(
              child.params
            )
          : child.params === "bg-background text-foreground");
      const tracking =
        rule.selector === "body" &&
        child.type === "decl" &&
        child.prop === "letter-spacing" &&
        child.value === "var(--tracking-normal)" &&
        !child.important;
      if (!(apply || tracking)) {
        throw child.error(
          "Move custom base styles out of the tweakcn theme input."
        );
      }
    });
  });
}

function checkScaffold(node) {
  if (node.name === "import" && tailwindImport.test(node.params)) {
    return;
  }
  if (
    node.name === "custom-variant" &&
    node.params === "dark (&:is(.dark *))"
  ) {
    return;
  }
  if (node.name === "theme" && node.params === "inline") {
    node.each((child) => {
      if (child.type === "comment") {
        return;
      }
      if (
        child.type !== "decl" ||
        !isStandardMapping(child.prop, child.value) ||
        child.important ||
        forbiddenValue.test(child.value)
      ) {
        throw child.error("Unsupported @theme scaffold.");
      }
    });
    return;
  }
  if (node.name === "layer" && node.params === "base") {
    checkBase(node);
    return;
  }
  throw node.error(
    "Unsupported theme scaffold. Paste tweakcn Tailwind v4 CSS, or :root/.dark token blocks."
  );
}

const radiusMappings = new Map([
  ["--radius-sm", "calc(var(--radius) - 4px)"],
  ["--radius-md", "calc(var(--radius) - 2px)"],
  ["--radius-lg", "var(--radius)"],
  ["--radius-xl", "calc(var(--radius) + 4px)"],
]);
const trackingOffsets = new Map([
  ["tighter", "- 0.05em"],
  ["tight", "- 0.025em"],
  ["wide", "+ 0.025em"],
  ["wider", "+ 0.05em"],
  ["widest", "+ 0.1em"],
]);

function isStandardMapping(prop, value) {
  if (prop.startsWith("--color-")) {
    const token = prop.replace("--color-", "--");
    return supported.has(token) && value === `var(${token})`;
  }
  if (supported.has(prop) && value === `var(${prop})`) {
    return true;
  }
  if (radiusMappings.get(prop) === value) {
    return true;
  }
  const offset = trackingOffsets.get(prop.replace("--tracking-", ""));
  return (
    offset !== undefined && value === `calc(var(--tracking-normal) ${offset})`
  );
}

export function parseTheme(css, from) {
  const result = { dark: {}, light: {} };
  postcss.parse(css, { from }).each((node) => {
    if (node.type === "comment") {
      return;
    }
    if (node.type === "rule" && [":root", ".dark"].includes(node.selector)) {
      readDeclarations(
        node,
        node.selector === ":root" ? result.light : result.dark
      );
      return;
    }
    if (node.type === "atrule") {
      checkScaffold(node);
      return;
    }
    throw node.error(
      "Theme inputs accept only :root, .dark and the standard tweakcn v4 scaffold."
    );
  });
  return result;
}

export function mergeThemes(themes) {
  const result = { dark: {}, light: {} };
  for (const [index, theme] of themes.entries()) {
    Object.assign(result.light, theme.light);
    const shared = Object.fromEntries(
      Object.entries(theme.light).filter(
        ([key]) => index === 0 || common.has(key)
      )
    );
    Object.assign(result.dark, shared, theme.dark);
  }
  return result;
}

export function themeRules(theme) {
  return Object.entries(theme).map(([mode, values]) => {
    const rule = postcss.rule({
      selector: mode === "light" ? ":root" : ":root.dark",
    });
    for (const [prop, value] of Object.entries(values)) {
      rule.append({ prop, value });
    }
    return rule;
  });
}
