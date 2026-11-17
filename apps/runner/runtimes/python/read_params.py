"""Reads the parameters of ``main`` from Python source on stdin.

The source is parsed with ``ast`` and never imported or executed. Prints
``{"schema": ...}`` or ``{"error": ...}`` as JSON.
"""

import ast
import json
import sys

SIMPLE = {"str": "string", "int": "integer", "float": "number", "bool": "boolean"}
LISTS = ("list", "List", "Sequence")


def name_of(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def is_none(node):
    return isinstance(node, ast.Constant) and node.value is None


def without_none(nodes):
    return [node for node in nodes if not is_none(node)]


def union_members(node):
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return union_members(node.left) + union_members(node.right)
    return [node]


def schema_of(node):
    """The form field for an annotation; ``{}`` means any JSON value."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        try:
            return schema_of(ast.parse(node.value, mode="eval").body)
        except SyntaxError:
            return {}
    name = name_of(node)
    if name in SIMPLE:
        return {"type": SIMPLE[name]}
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        members = without_none(union_members(node))
        return schema_of(members[0]) if len(members) == 1 else {}
    if isinstance(node, ast.Subscript):
        base = name_of(node.value)
        inner = node.slice
        if base == "Optional":
            return schema_of(inner)
        if base == "Union":
            members = without_none(inner.elts if isinstance(inner, ast.Tuple) else [inner])
            return schema_of(members[0]) if len(members) == 1 else {}
        if base in LISTS:
            item = schema_of(inner)
            if item.get("type") in SIMPLE.values() and "enum" not in item:
                return {"type": "array", "items": {"type": item["type"]}}
            return {}
        if base == "Literal":
            values = inner.elts if isinstance(inner, ast.Tuple) else [inner]
            if all(isinstance(v, ast.Constant) and isinstance(v.value, str) for v in values):
                return {"type": "string", "enum": [v.value for v in values]}
    return {}


def schema_of_value(value):
    """The field for a parameter that has a default but no annotation."""
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "number"}
    if isinstance(value, str):
        return {"type": "string"}
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return {"type": "array", "items": {"type": "string"}}
    return {}


def literal_of(node):
    """Returns (known, value) for a default written as a plain literal."""
    try:
        value = ast.literal_eval(node)
        json.dumps(value)
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        return False, None
    return True, value


def find_main(tree):
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "main":
            return node
    return None


def inspect_source(source):
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return {"error": "Syntax error on line %s: %s" % (error.lineno, error.msg)}
    main = find_main(tree)
    if main is None:
        return {"error": "No function named main was found."}
    arguments = main.args
    if arguments.vararg or arguments.kwarg:
        return {"error": "main cannot take *args or **kwargs."}
    if arguments.posonlyargs:
        return {"error": "main cannot take positional-only parameters."}

    positional = arguments.args
    defaults = [None] * (len(positional) - len(arguments.defaults)) + list(arguments.defaults)
    parameters = list(zip(positional, defaults)) + list(zip(arguments.kwonlyargs, arguments.kw_defaults))

    schema = {"type": "object", "properties": {}, "required": [], "x-order": []}
    for argument, default in parameters:
        known, value = literal_of(default) if default is not None else (False, None)
        if argument.annotation is not None:
            field = schema_of(argument.annotation)
        elif known and value is not None:
            field = schema_of_value(value)
        else:
            field = {"type": "string"}
        if known and value is not None:
            field["default"] = value
        schema["properties"][argument.arg] = field
        schema["x-order"].append(argument.arg)
        if default is None:
            schema["required"].append(argument.arg)
    return {"schema": schema}


json.dump(inspect_source(sys.stdin.read()), sys.stdout)
