# Decision 0006: Functions on a dedicated runner VM

- Status: accepted
- Date: 2026-11-21

## Context

Teams using the toolkit want small server-side scripts, like AWS Lambda functions, next to their stores and databases: Node.js/TypeScript or Python, with packages, run by hand, over HTTP or on a schedule. [Decision 0001](./0001-toolkit-architecture.md) left "an arbitrary-code node" out of scope, and [decision 0005](./0005-database-backups-with-native-dump-tools.md) rejected `docker run` because the API container has no Docker socket. This feature runs arbitrary code by design, so both need an answer.

The deployed API process holds `DATABASE_URL`, `SHOPIFY_TOKEN_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`. Any code that runs with the API's user, or can talk to the API's Docker daemon, can read them.

## Decision

Run functions on a separate VM that owns Docker, one short-lived container per run, and keep every secret on the API side.

- **Where code runs.** A `runner` VM on the Proxmox host (2 vCPU, 4 GiB, 32 GiB) runs Docker and a small agent (`apps/runner`). The API calls the agent over the LAN with TLS from the private CA and a bearer token; the agent port answers only to the API's host. The API never gets a Docker socket.
- **Isolation.** Each run is a new container: read-only root, `/tmp` on tmpfs, non-root user, all capabilities dropped, `no-new-privileges`, memory, CPU and process limits, a timeout, and no swap. Containers join a bridge network with inter-container traffic off, whose egress to private ranges (10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16) and to the runner host is dropped. The internet is reachable.
- **Execution path.** The API starts the run with a streaming request and writes output into the run row as it arrives; the UI polls the row. The job queue only fires schedules.
- **Parameters** are read from the signature of `main` by parsing the entry file (the TypeScript parser, Python's `ast`), never by running it.
- **Packages** install in a separate container that gets no variables and the same network restrictions, cached on the runner by a hash of the manifests and mounted read-only into runs.
- **Secrets of a function.** Variables are encrypted with the existing key, reach a run through its standard input (never as `docker` arguments), are absent from installs, and are scrubbed from stored output and results.
- **HTTP trigger.** `POST /api/fn/{functionId}` on the existing public origin, authorized by a per-function token stored as a hash. Refusals are an empty 401.
- **Built-in helpers.** Functions reach the organization's databases and stores through a `wizdek` module that calls the API's helper routes on a separate port (`FUNCTIONS_RUNTIME_PORT`). Each run gets a token valid only while it runs; the API checks the function's grant list, decrypts the stored credentials and makes the call itself, so no connection string or Shopify token enters the sandbox. Writes to production databases and Shopify mutations are allowed through a grant, and every write and mutation is audited with the run. The runner's egress filter has exactly one LAN exception for this: the API host on the helper port.
- **Runner interface.** The API talks to a `FunctionRunner` interface, so another backend such as AWS Lambda can be added later.

## Why this differs from decisions 0001 and 0005

Decision 0001 excluded an arbitrary-code node inside flows: code that would run in the API's worker, next to its secrets and with every store's credentials in reach. Functions run on another machine, behind a VM boundary, with no secret of the toolkit and only the credentials a grant brokers through the API. A code node inside flows remains out of scope.

Decision 0005 rejected `docker run` because the API container has no Docker socket. That is still true: the runner VM owns its Docker daemon, and the API only speaks HTTPS to the agent.

## Alternatives rejected

| Approach | Why not |
|----------|---------|
| A child process of the API | Runs with the API's user, which can read the API's environment and files, including the encryption key. |
| Docker on the API's host (apps-prod) | Access to that daemon is access to every production container's environment. |
| Firecracker or another microVM per run | Stronger isolation, but kernels, images and networking to operate for a tool used by an organization's own developers. Kept as the answer if untrusted tenants arrive. |
| AWS Lambda | Cost, a second cloud account and its credentials, and functions could not reach the home network's services. The runner interface leaves room for it. |
| Embedding code-server | A standing server with a terminal on the runner. Monaco, which the GraphQL console already ships, covers editing. |
| Passing database URLs or store tokens into the sandbox | A function could print or send them, and the toolkit promises that no API returns a token. |

## What was verified

- `apps/runner/integration/run.integration.test.ts`, against local Docker: runs in both runtimes, parameters, timeouts, cancellation, output truncation, the memory limit, a read-only filesystem, a non-root user, and that a run sees only the variables it was given.
- `apps/runner/integration/deps.integration.test.ts`: npm and PyPI installs, the cache, the size cap, and an install script that finds none of the agent's settings.
- `apps/runner/integration/sdk.integration.test.ts`: the `wizdek` module in real Node and Python containers, with throttle retries and paging.
- `packages/functions/integration` and `packages/api/integration`: run lifecycle, the HTTP trigger and its refusals, schedules firing through pg-boss, variable scrubbing, permissions and tenancy, and the helper routes (the run token dies with the run, grants are checked on every call, writes are audited without their values, large results are cut, concurrent calls are limited).
- The Monaco editor starts its TypeScript worker under both `next dev` and `next build`, and coexists with GraphiQL's own Monaco environment.
- On the runner VM (2026-11-21), before and after a reboot: the egress probe (public internet reachable; every LAN host, the runner itself and other containers refused; only the API's helper port passes the filter) and the agent port restriction (only apps-prod connects, and it verifies the runner's certificate against the private CA). The connection to the helper port itself is checked when the API is deployed; the release does not proceed if any other address in the probe answers.

## Behaviour to know about

**Containers share the runner's kernel.** A kernel escape reaches the runner VM, which holds no toolkit secret at rest; a function's variables pass through it only during its run. This is acceptable for code written by an organization's Owners and Admins, not for strangers' code.

**Functions use the home connection's public IP** for outbound requests.

**A run does not survive an API restart.** The API drives each run over one streaming request. A graceful shutdown cancels running runs; runs left running by a crash are marked failed at startup.

**A grant outlives the permissions of the person who made it.** Grants are listed on the function and can be removed; removing someone's role does not remove their grants.

**Cancelling a run does not stop a helper call already in progress.** The run's token stops working for the next call, and the call in progress ends at its own timeout of at most 60 seconds.

## When to revisit

Before functions serve organizations whose developers are not trusted, before a function needs a fixed outbound IP, or when runs routinely need more than the runner's 2.5 GB of memory budget.
