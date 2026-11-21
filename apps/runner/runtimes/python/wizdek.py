"""The ``wizdek`` module functions import.

It reaches the organization's granted databases and Shopify stores through
Wizdek's runtime API with the run's token; no connection string or store
token ever enters the sandbox. Standard library only.
"""

import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

__all__ = ["WizdekError", "ctx", "databases", "db", "shopify", "stores"]

_PATH_PREFIX = "/api/fn-runtime"
_MAX_THROTTLE_RETRIES = 5
_MAX_THROTTLE_WAIT_SECONDS = 30
_REQUEST_TIMEOUT_SECONDS = 90
_PLACEHOLDER = re.compile(r"%%|%s")


class WizdekError(Exception):
    """A helper call that failed; ``status`` is the runtime API's HTTP status."""

    def __init__(self, message, status=None, errors=None, response=None):
        super().__init__(message)
        self.status = status
        #: Shopify's ``errors``, for a GraphQL call.
        self.errors = errors
        #: Shopify's whole answer, for a GraphQL call.
        self.response = response


def _settings():
    token = os.environ.get("WIZDEK_RUNTIME_TOKEN")
    url = os.environ.get("WIZDEK_RUNTIME_URL")
    if not (token and url):
        raise WizdekError(
            "The wizdek helpers work only inside a Wizdek run: "
            "WIZDEK_RUNTIME_TOKEN is not set."
        )
    return token, url.rstrip("/")


def _call(method, path, body=None):
    token, url = _settings()
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url + _PATH_PREFIX + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=_REQUEST_TIMEOUT_SECONDS) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise WizdekError(
                "Wizdek refused this run's helper token: the run has ended.", status=401
            ) from None
        text = error.read().decode("utf-8", "replace")
        try:
            message = json.loads(text).get("error")
        except (ValueError, AttributeError):
            message = None
        raise WizdekError(
            message or "Wizdek answered %s." % error.code, status=error.code
        ) from None
    except urllib.error.URLError as error:
        raise WizdekError("Could not reach Wizdek: %s" % error.reason) from None


def _segment(alias):
    if not isinstance(alias, str) or alias == "":
        raise WizdekError("Name the store or database by its alias or id.")
    return urllib.parse.quote(alias, safe="")


def _to_dollar(sql):
    """Turns ``%s`` placeholders into ``$1``, ``$2``; ``%%`` stays a ``%``."""
    count = 0

    def replace(match):
        nonlocal count
        if match.group(0) == "%%":
            return "%"
        count += 1
        return "$%d" % count

    return _PLACEHOLDER.sub(replace, sql) if "%s" in sql else sql


def _statement(sql, params):
    return {"sql": _to_dollar(sql), "params": list(params or [])}


def _warn_truncated(alias, result):
    if result.get("truncated"):
        print(
            'wizdek: the result from "%s" was cut at the row or size limit; '
            "page through it with LIMIT and OFFSET." % alias,
            file=sys.stderr,
        )


class _Context:
    """What the run is: ids, and what started it."""

    @property
    def function_id(self):
        return os.environ.get("WIZDEK_FUNCTION_ID")

    @property
    def organization_id(self):
        return os.environ.get("WIZDEK_ORGANIZATION_ID")

    @property
    def run_id(self):
        return os.environ.get("WIZDEK_RUN_ID")

    @property
    def trigger(self):
        return os.environ.get("WIZDEK_TRIGGER")


ctx = _Context()


class _Database:
    def __init__(self, alias):
        self._alias = alias
        self._base = "/db/" + _segment(alias)

    def run(self, sql, params=None):
        """Runs one statement and returns its result: command, rows, fields."""
        result = _call("POST", self._base + "/query", _statement(sql, params))
        _warn_truncated(self._alias, result)
        return result

    def query(self, sql, params=None):
        """Runs one statement and returns its rows. Use ``%s`` or ``$1`` for values."""
        return self.run(sql, params)["rows"]

    def execute(self, sql, params=None):
        """Runs one statement and returns how many rows it changed."""
        return self.run(sql, params)["rowCount"]

    def transaction(self, statements):
        """Runs statements in one transaction: all of them, or none when one fails.

        Each statement is ``(sql, params)`` or ``{"sql": ..., "params": ...}``;
        returns their results in order.
        """
        if not statements:
            raise WizdekError("Pass the transaction's statements as a list of (sql, params).")
        payload = []
        for statement in statements:
            if isinstance(statement, dict):
                payload.append(_statement(statement["sql"], statement.get("params")))
            else:
                sql, params = (statement[0], statement[1] if len(statement) > 1 else None)
                payload.append(_statement(sql, params))
        results = _call("POST", self._base + "/transaction", {"statements": payload})["results"]
        for result in results:
            _warn_truncated(self._alias, result)
        return results


def db(alias):
    """A database connection granted to this function, by alias or id."""
    return _Database(alias)


def _is_throttled(body):
    errors = (body or {}).get("errors") or []
    return any(
        isinstance(error, dict) and (error.get("extensions") or {}).get("code") == "THROTTLED"
        for error in errors
    )


def _throttle_wait_seconds(body):
    cost = ((body or {}).get("extensions") or {}).get("cost") or {}
    status = cost.get("throttleStatus") or {}
    rate = status.get("restoreRate")
    if not rate:
        return 1
    missing = (cost.get("requestedQueryCost") or 0) - (status.get("currentlyAvailable") or 0)
    return min(max(1, math.ceil(missing / rate)), _MAX_THROTTLE_WAIT_SECONDS)


def _value_at(data, path):
    if not path:
        if not isinstance(data, dict) or len(data) != 1:
            raise WizdekError(
                'Give paginate a path, such as path="orders": the query selects more than one field.'
            )
        return next(iter(data.values()))
    value = data
    for key in path.split("."):
        value = value.get(key) if isinstance(value, dict) else None
    return value


class _Store:
    def __init__(self, alias):
        self._path = "/shopify/" + _segment(alias) + "/graphql"

    def graphql(self, query, variables=None, operation_name=None, api_version=None):
        """Runs an Admin API query or mutation and returns Shopify's answer.

        Throttled calls are retried; other GraphQL errors raise. ``userErrors``
        in a mutation's payload are left to you.
        """
        attempt = 0
        while True:
            body = _call(
                "POST",
                self._path,
                {
                    "apiVersion": api_version,
                    "operationName": operation_name,
                    "query": query,
                    "variables": variables,
                },
            )["body"]
            if _is_throttled(body) and attempt < _MAX_THROTTLE_RETRIES:
                attempt += 1
                time.sleep(_throttle_wait_seconds(body))
                continue
            errors = (body or {}).get("errors") or []
            if errors:
                messages = [str(error.get("message")) for error in errors if isinstance(error, dict)]
                raise WizdekError(
                    "Shopify: " + "; ".join(messages), errors=errors, response=body
                )
            return body

    def paginate(self, query, variables=None, path=None, operation_name=None, api_version=None):
        """Pages through a connection and yields its nodes.

        The query takes a ``$cursor: String`` variable for ``after:`` and
        selects ``pageInfo { hasNextPage endCursor }``; ``path`` names the
        connection inside ``data``, such as ``"orders"``.
        """
        cursor = None
        while True:
            body = self.graphql(
                query,
                dict(variables or {}, cursor=cursor),
                operation_name=operation_name,
                api_version=api_version,
            )
            connection = _value_at(body.get("data"), path)
            if not connection:
                raise WizdekError('No connection at "%s" in the answer.' % (path or "the only field"))
            if connection.get("nodes") is not None:
                nodes = connection["nodes"]
            else:
                nodes = [edge.get("node") for edge in connection.get("edges") or []]
            yield from nodes
            page_info = connection.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                return
            cursor = page_info.get("endCursor")


def shopify(alias):
    """A Shopify store granted to this function, by alias or id."""
    return _Store(alias)


_context = None


def _grants():
    global _context
    if _context is None:
        _context = _call("GET", "/context")
    return _context["grants"]


class _Listing:
    def __init__(self, kind):
        self._kind = kind

    def list(self):
        return list(_grants()[self._kind])


#: The stores this function may use, by alias.
stores = _Listing("stores")
#: The database connections this function may use, by alias.
databases = _Listing("databases")
