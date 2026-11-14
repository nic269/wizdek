import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import ts from "typescript";

const moduleRoot = resolve(import.meta.dirname, "..");
let checked = 0;
function checkSpecifier(specifier: string, file: string) {
  if (specifier?.startsWith(".")) {
    if (!resolve(dirname(file), specifier).startsWith(moduleRoot + sep)) {
      throw new Error(`OMS module imports another app feature: ${file}`);
    }
  } else if (
    specifier?.startsWith("@repo/") &&
    !specifier.startsWith("@repo/design-system") &&
    !(
      specifier === "@repo/auth/session" &&
      file === resolve(moduleRoot, "server/identity/wizdek-session.ts")
    )
  ) {
    throw new Error(
      `Unexpected shared server dependency in OMS module: ${specifier}`
    );
  }
}
function inspect(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      inspect(file);
      continue;
    }
    if (![".ts", ".tsx"].includes(extname(file))) {
      continue;
    }
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    function visit(node: ts.Node) {
      let specifier: string | undefined;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifier = node.moduleSpecifier.text;
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        specifier = node.arguments[0].text;
      }
      if (specifier) {
        checkSpecifier(specifier, file);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    checked += 1;
  }
}
for (const folder of ["components", "server", "lib"]) {
  inspect(resolve(moduleRoot, folder));
}
console.log(
  `OMS module isolation passed (${checked} files; shared design system and identity adapter only).`
);
