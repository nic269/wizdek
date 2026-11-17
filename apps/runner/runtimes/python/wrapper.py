"""Runs inside the sandbox container.

Reads one JSON request from stdin, calls the function's ``main``, and ends
stdout with one line holding the result: ``<marker> <json>``.
"""

import asyncio
import importlib.util
import inspect
import json
import os
import sys
import traceback


def finish(marker, code, result):
    sys.stderr.flush()
    sys.stdout.write("\n%s %s\n" % (marker, json.dumps(result)))
    sys.stdout.flush()
    # Exit even when the function left threads running.
    os._exit(code)


def load(entry):
    sys.path.insert(0, "/fn")
    spec = importlib.util.spec_from_file_location("main", "/fn/" + entry)
    module = importlib.util.module_from_spec(spec)
    sys.modules["main"] = module
    spec.loader.exec_module(module)
    return module


def run():
    request = json.loads(sys.stdin.buffer.read())
    marker = request["marker"]
    try:
        os.environ.update(request["env"])
        main = getattr(load(request["entry"]), "main", None)
        if not callable(main):
            raise TypeError("%s must define a function named main." % request["entry"])
        value = main(**request["params"])
        if inspect.iscoroutine(value):
            value = asyncio.run(value)
        try:
            json.dumps(value)
        except (TypeError, ValueError) as error:
            raise TypeError("The value main returned is not JSON: %s" % error)
        finish(marker, 0, {"ok": True, "value": value})
    except SystemExit as error:
        if error.code is None or error.code == 0:
            finish(marker, 0, {"ok": True, "value": None})
        code = error.code if isinstance(error.code, int) else 1
        finish(marker, code, {"ok": False, "error": "main exited with code %s." % code})
    except BaseException as error:  # noqa: BLE001 - report every failure
        traceback.print_exc()
        finish(marker, 1, {"ok": False, "error": "%s: %s" % (type(error).__name__, error)})


run()
