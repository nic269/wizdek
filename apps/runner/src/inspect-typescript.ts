import ts from "typescript";
import type {
  InspectResult,
  ParamSchema,
  ParamsSchema,
  ParamType,
} from "./protocol";

type ItemType = Exclude<ParamType, "array">;

const PRIMITIVES = new Map<ts.SyntaxKind, ItemType>([
  [ts.SyntaxKind.StringKeyword, "string"],
  [ts.SyntaxKind.NumberKeyword, "number"],
  [ts.SyntaxKind.BooleanKeyword, "boolean"],
]);

const isNullish = (node: ts.TypeNode): boolean =>
  node.kind === ts.SyntaxKind.UndefinedKeyword ||
  (ts.isLiteralTypeNode(node) &&
    node.literal.kind === ts.SyntaxKind.NullKeyword);

const stringLiteralOf = (node: ts.TypeNode): string | undefined =>
  ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)
    ? node.literal.text
    : undefined;

const arrayOf = (element: ts.TypeNode): ParamSchema => {
  const type = PRIMITIVES.get(element.kind);
  return type ? { items: { type }, type: "array" } : {};
};

/** The form field for a type annotation; `{}` means any JSON value. */
const schemaOfType = (
  node: ts.TypeNode
): { optional: boolean; schema: ParamSchema } => {
  const primitive = PRIMITIVES.get(node.kind);
  if (primitive) {
    return { optional: false, schema: { type: primitive } };
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return schemaOfType(node.type);
  }
  if (ts.isArrayTypeNode(node)) {
    return { optional: false, schema: arrayOf(node.elementType) };
  }
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "Array" &&
    node.typeArguments?.[0]
  ) {
    return { optional: false, schema: arrayOf(node.typeArguments[0]) };
  }
  const literal = stringLiteralOf(node);
  if (literal !== undefined) {
    return { optional: false, schema: { enum: [literal], type: "string" } };
  }
  if (ts.isUnionTypeNode(node)) {
    const members = node.types.filter((member) => !isNullish(member));
    const optional = members.length < node.types.length;
    const only = members.length === 1 ? members[0] : undefined;
    if (only) {
      return { optional, schema: schemaOfType(only).schema };
    }
    const choices = members.map(stringLiteralOf);
    if (choices.length > 0 && choices.every((choice) => choice !== undefined)) {
      return {
        optional,
        schema: { enum: choices as string[], type: "string" },
      };
    }
    return { optional, schema: {} };
  }
  return { optional: false, schema: {} };
};

type Literal = { known: true; value: unknown } | { known: false };

const UNKNOWN: Literal = { known: false };

/** The value of a default that is written as a plain literal. */
const literalOf = (node: ts.Expression): Literal => {
  if (ts.isStringLiteralLike(node)) {
    return { known: true, value: node.text };
  }
  if (ts.isNumericLiteral(node)) {
    return { known: true, value: Number(node.text) };
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return { known: true, value: -Number(node.operand.text) };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return { known: true, value: true };
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return { known: true, value: false };
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values: unknown[] = [];
    for (const element of node.elements) {
      const literal = literalOf(element);
      if (!literal.known) {
        return UNKNOWN;
      }
      values.push(literal.value);
    }
    return { known: true, value: values };
  }
  return UNKNOWN;
};

/** The field for a parameter that has a default but no annotation. */
const schemaOfValue = (value: unknown): ParamSchema => {
  if (typeof value === "string") {
    return { type: "string" };
  }
  if (typeof value === "number") {
    return { type: "number" };
  }
  if (typeof value === "boolean") {
    return { type: "boolean" };
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return { items: { type: "string" }, type: "array" };
  }
  return {};
};

type MainFunction =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction;

const asFunction = (
  node: ts.Expression | undefined
): MainFunction | undefined =>
  node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    ? node
    : undefined;

/** `const main = () => …` */
const mainFromVariable = (
  statement: ts.VariableStatement
): MainFunction | undefined => {
  for (const declaration of statement.declarationList.declarations) {
    const found =
      ts.isIdentifier(declaration.name) && declaration.name.text === "main"
        ? asFunction(declaration.initializer)
        : undefined;
    if (found) {
      return found;
    }
  }
};

/** `module.exports.main = …` or `exports.main = …` */
const mainFromAssignment = (
  statement: ts.ExpressionStatement
): MainFunction | undefined => {
  const { expression } = statement;
  return ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(expression.left) &&
    expression.left.name.text === "main"
    ? asFunction(expression.right)
    : undefined;
};

const mainFromStatement = (
  statement: ts.Statement
): MainFunction | undefined => {
  if (ts.isFunctionDeclaration(statement)) {
    return statement.name?.text === "main" ? statement : undefined;
  }
  if (ts.isVariableStatement(statement)) {
    return mainFromVariable(statement);
  }
  if (ts.isExpressionStatement(statement)) {
    return mainFromAssignment(statement);
  }
};

/** Finds a top-level `main`, however it is declared or assigned. */
const findMain = (source: ts.SourceFile): MainFunction | undefined => {
  for (const statement of source.statements) {
    const found = mainFromStatement(statement);
    if (found) {
      return found;
    }
  }
};

const LEADING_DASH = /^-\s*/;

const describe = (parameter: ts.ParameterDeclaration): string | undefined => {
  const comment = ts.getJSDocParameterTags(parameter)[0]?.comment;
  const text = ts
    .getTextOfJSDocComment(comment)
    ?.replace(LEADING_DASH, "")
    .trim();
  return text || undefined;
};

/**
 * Reads the parameters of `main` from a TypeScript or JavaScript file by
 * parsing it. The file is never executed or type-checked.
 */
export const inspectTypeScript = (text: string): InspectResult => {
  const source = ts.createSourceFile(
    "index.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const main = findMain(source);
  if (!main) {
    return { error: "No function named main was found." };
  }

  const schema: ParamsSchema = {
    properties: {},
    required: [],
    type: "object",
    "x-order": [],
  };
  for (const parameter of main.parameters) {
    if (parameter.dotDotDotToken) {
      return { error: "main cannot take a rest parameter." };
    }
    if (!ts.isIdentifier(parameter.name)) {
      return {
        error: "main must take named parameters, not a destructured one.",
      };
    }
    const name = parameter.name.text;
    const fromType = parameter.type ? schemaOfType(parameter.type) : undefined;
    const literal = parameter.initializer
      ? literalOf(parameter.initializer)
      : UNKNOWN;

    let field: ParamSchema;
    if (fromType) {
      field = { ...fromType.schema };
    } else if (literal.known) {
      field = schemaOfValue(literal.value);
    } else {
      field = { type: "string" };
    }
    if (literal.known) {
      field.default = literal.value;
    }
    const description = describe(parameter);
    if (description) {
      field.description = description;
    }

    schema.properties[name] = field;
    schema["x-order"].push(name);
    const optional =
      parameter.questionToken !== undefined ||
      parameter.initializer !== undefined ||
      fromType?.optional === true;
    if (!optional) {
      schema.required.push(name);
    }
  }
  return { schema };
};
