# Functions

The **Functions** page runs short scripts on the server, the way AWS Lambda does. A function is a small folder of Node.js/TypeScript or Python files with a `main` entry point. You can run it by hand with a form, call it over HTTP, or put it on a schedule. Every run keeps its output, result, exit code and duration.

Functions run on a separate runner machine, one container per run, never inside the toolkit's API. While no runner is configured, the page says functions are not enabled.

## Who can use it

| Permission | Allows |
|------------|--------|
| `functions:read` | Seeing functions, their files and run history |
| `functions:manage` | Creating, editing and deleting functions; variables, triggers, schedules and connections |
| `functions:run` | Running a function from the page |

Owners and Admins have all three. Members and Viewers have none, because a function runs code with internet access. Give someone access with a custom role under **Settings → Access**.

## Writing a function

Choose **New function**, give it a name and pick a runtime: Node.js (TypeScript) or Python 3.13. The editor opens with a starter file. Add files and folders in the file tree. Choose **Save** before running: runs always use the saved files.

| Runtime | Entry file | Packages from |
|---------|-----------|---------------|
| Node.js (TypeScript) | `index.ts`, `index.mts`, `index.js` or `index.mjs` | `package.json` (and `package-lock.json`) |
| Python 3.13 | `main.py` | `requirements.txt` |

The entry file must export or define a function named `main`. It may be `async`. Whatever it returns, as JSON, is the run's result.

```ts
export async function main(orderId: string, limit: number = 10, dryRun: boolean = false) {
  console.log("checking", orderId);
  return { orderId, limit, dryRun };
}
```

```python
def main(order_id: str, limit: int = 10, dry_run: bool = False):
    print("checking", order_id)
    return {"order_id": order_id, "limit": limit, "dry_run": dry_run}
```

TypeScript runs through Node's type stripping, so type annotations work but features that need compiling, such as `enum` and namespaces, do not. Relative imports may leave out the extension (`./lib/util`).

### Parameters

The parameters of `main` become the fields of the **Test** form. The toolkit reads them from the saved source without running it, so the form changes as soon as you save a new signature.

| TypeScript | Python | Field |
|------------|--------|-------|
| `string` | `str` | Text |
| `number` | `float` | Number |
| | `int` | Whole number |
| `boolean` | `bool` | Checkbox |
| `"a" \| "b"` | `Literal["a", "b"]` | Choice |
| `string[]`, `number[]` | `list[str]`, `list[int]` | List |

A default value makes a parameter optional. A parameter without a type that the toolkit understands, or a rest parameter, is reported under the editor.

### Packages

Saving a `package.json` or `requirements.txt` installs its packages on the runner in a separate container with no variables, no connections and no access to private networks. While it installs, the editor says so; a failed install shows the end of its log and a button to install again. A run is refused until the packages are installed. The same manifest is installed once and reused; changing it installs again. An install may take up to 300 seconds and 500 MB.

## Running

Fill in the **Test** form and choose **Run**. The **Output** tab shows stdout and stderr as they arrive, then the result, the exit code and the duration. A failing run shows its error and traceback. **Cancel** stops a run. **History** lists the newest 200 runs of the function.

| Status | Meaning |
|--------|---------|
| Queued | Waiting for room on the runner |
| Running | The container is running |
| Succeeded | `main` returned; the result is shown |
| Failed | `main` threw, the process exited non-zero, or the memory limit was hit |
| Timed out | The run took longer than the function's timeout |
| Canceled | Someone chose Cancel |

Under **Settings** you set the timeout (up to 900 seconds, 60 by default) and the memory (128, 256, 512 or 1024 MB). Each run gets one CPU.

## Calling a function over HTTP

Under **Triggers**, choose **Turn on**. The token is shown once; copy it then. Only a hash is stored, so a lost token can only be replaced with **New token**, which stops the old one working.

```bash
curl -X POST https://tools.wizloft.dev/api/fn/FUNCTION_ID \
  -H "x-function-token: wfn_..." \
  -H "content-type: application/json" \
  -d '{"orderId": "#1001"}'
```

The JSON body is the parameters. `Authorization: Bearer wfn_...` works as well as the header.

| Answer | When |
|--------|------|
| 200 with `result` | The run succeeded within 90 seconds |
| 202 with `runId` | The run is still going after 90 seconds; ask `GET /api/fn/FUNCTION_ID/runs/RUN_ID` with the same token later |
| 500 with `error` | The run failed |
| 401, empty | The token is missing or wrong, or the trigger is off; no run is started |
| 413, 422, 429, 503 | The body is over 1 MB or not a JSON object, over 60 calls a minute, or the runner is busy (`Retry-After` says when to retry) |

Answers carry the result or the error, never the output.

## Schedules

Under **Triggers**, **Add schedule** takes five cron fields (`0 6 * * *` is every day at 06:00), a time zone and the parameters to run with. A function may have 5 schedules. A disabled schedule keeps its settings and starts nothing.

## Variables

Under **Variables**, add values such as API keys. A run reads them from its environment (`process.env.API_KEY`, `os.environ["API_KEY"]`). Values are stored encrypted and never shown again. Any value of 6 characters or more that a run prints is replaced with `[redacted]` in the stored output and result. Package installs do not get them.

Names use capital letters, digits and underscores. `PATH`, `HOME`, `NODE_OPTIONS`, `NODE_PATH`, `PYTHONPATH`, `PYTHONHOME` and names starting with `FN_`, `LD_` or `WIZDEK_` are reserved. A function may have 50 variables of up to 8 KB each.

## Databases and Shopify stores

A function can query and write the organization's saved [database connections](./database.md) and run Admin GraphQL on its connected [stores](./stores.md) through the built-in `wizdek` module, without a connection string or token in the code.

First grant the function what it may use: under **Settings → Connections**, choose a store or database and an alias, such as `analytics` or `main-store`. Granting a database needs `databases:read`; granting a store needs `stores:read` and `graphql:mutate`, because a granted store allows mutations. A grant applies to every run, whether started by hand, over HTTP or by a schedule. Disconnecting a store or deleting a connection removes its grants.

```ts
import { ctx, db, shopify } from "wizdek";

export async function main(orderId: string) {
  const rows = await db("analytics").query(
    "select * from orders where id = $1",
    [orderId]
  );
  await db("analytics").execute(
    "insert into notes (order_id, run_id) values ($1, $2)",
    [orderId, ctx.runId]
  );
  const { data } = await shopify("main-store").graphql(
    "query ($id: ID!) { order(id: $id) { name } }",
    { id: orderId }
  );
  return { rows, order: data.order };
}
```

```python
from wizdek import ctx, db, shopify

def main(order_id: str):
    rows = db("analytics").query("select * from orders where id = %s", [order_id])
    order = shopify("main-store").graphql(
        "query ($id: ID!) { order(id: $id) { name } }", {"id": order_id}
    )["data"]["order"]
    return {"rows": rows, "order": order}
```

| Helper | Does |
|--------|------|
| `db(alias).query(sql, params)` | Runs one statement and returns its rows |
| `db(alias).execute(sql, params)` | Runs one statement and returns how many rows it changed |
| `db(alias).run(sql, params)` | Returns the whole result: `command`, `rows`, `rowCount`, `fields`, `truncated` |
| `db(alias).transaction([{ sql, params }, …])` | Runs the statements in one transaction, all or none; Python also takes `(sql, params)` tuples |
| `shopify(alias).graphql(query, variables, options)` | Runs a query or mutation and returns Shopify's answer (`data`, `extensions`) |
| `shopify(alias).paginate(query, variables, { path })` | Yields every node of a connection, page by page |
| `ctx` | `runId`, `functionId`, `organizationId`, `trigger` (Python: `run_id`, `function_id`, …) |
| `stores.list()`, `databases.list()` | The aliases granted to the function |
| `WizdekError` | What a failed call raises; it carries `status`, and for GraphQL `errors` and `response` |

Values are always sent apart from the SQL: use `$1`, `$2` in Node and `%s` in Python (`%%` for a literal `%`). Each call holds one statement; several statements in one string are refused. A query keeps at most 10 000 rows and about 10 MB, and then sets `truncated` and prints a warning. Each call may take up to 60 seconds, and never longer than what is left of the run. A run may have 4 database calls and 20 calls in all in flight at once.

For `paginate`, the query takes a `$cursor: String` variable for `after:` and selects `pageInfo { hasNextPage endCursor }`; `path` names the connection, such as `"orders"`. Throttled Shopify calls are retried up to five times after the wait Shopify reports. Other GraphQL errors raise; `userErrors` in a mutation's payload are left to your code.

**What is recorded.** Every statement that is not a `select`, `show` or `explain`, and every Shopify mutation, leaves an audit entry naming the function and the run; a database entry keeps the SQL but not its values. Reads are counted on the run (the **Database calls** and **Shopify calls** figures in the run details). Writes to a production database are allowed: the grant list and the audit log are the controls.

**How it stays safe.** The credentials never reach the run. Each run gets a token that works only while it runs and only for what is granted to its function; the toolkit's API runs the call with the stored credentials. The token is replaced with `[redacted]` in stored output.

Outside a run, for example when you test a file on your own computer, importing `wizdek` works but every call fails with a message naming `WIZDEK_RUNTIME_TOKEN`.

## What a function can reach

- The public internet, from the runner's connection.
- The toolkit's helper routes for the `wizdek` module, and nothing else on the toolkit's private network: not its database, not other servers, not other runs.
- Its own files (read-only), its packages (read-only) and `/tmp` (writable, cleared after the run).

It cannot read the toolkit's secrets, other functions' variables, or stored database URLs and Shopify tokens. Runs share the runner machine's kernel, so the isolation is meant for code written by the organization's own Owners and Admins, not for code from strangers. [Decision 0006](./decisions/0006-functions-on-a-dedicated-runner-vm.md) explains the design.

## Limits

| Item | Limit |
|------|-------|
| Source | 50 files, 256 KB per file, 1 MB per function |
| Timeout | 60 seconds by default, up to 900 |
| Memory | 128, 256 (default), 512 or 1024 MB; 1 CPU; 128 processes |
| Output | 1 MB stored, then cut |
| Result | JSON up to 256 KB |
| Packages | 500 MB per install; 300 seconds |
| HTTP trigger | 1 MB body; answer within 90 seconds or 202; 60 calls a minute per function |
| History | Newest 200 runs per function |
| Schedules, variables | 5 schedules; 50 variables of 8 KB |
| Database and Shopify helpers | 60 seconds per call; 10 000 rows or 10 MB per result; 4 database and 20 total calls in flight per run |

## Running functions locally

See the [root README](../README.md#functions) for starting the runner agent against your own Docker.
