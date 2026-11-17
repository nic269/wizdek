---
phase: 2
title: "Phase 2: Runner Agent and Runtime Images"
status: completed
priority: P1
effort: "2.5d"
dependencies: []
---

# Phase 2: Runner Agent and Runtime Images

## Context Links

- Child-process pattern to adapt: `packages/database-tools/src/engines/run-tool.ts` (no shell, explicit environment, abort to SIGTERM then SIGKILL)
- Server pattern: `apps/api/src/index.ts`, `apps/api/tsup.config.ts`, `apps/api/env.ts`
- Image build: `Dockerfile` (multi-target), `scripts/docker/validate-production-runtimes.mjs`
- Form the schema must feed: `apps/app/app/flows/[flowId]/config-forms/generic-form.tsx`

## Overview

Build the runner agent: a small HTTPS service that owns Docker on the runner VM, runs each request in a one-shot container, streams its output, and reads a function's parameters without executing it. It is developed and tested against local Docker.

## Key Insights

- The agent is the only component with the Docker socket. It imports no workspace package that reads application secrets, and its environment holds only its own token and paths.
- Node 24 runs `.ts` files by stripping types. Only erasable syntax works (no `enum`, `namespace` or parameter properties), and relative imports need the `.ts` extension.
- Bind mounts are resolved by the Docker daemon on the host. When the agent itself runs in a container, its work directory must be mounted at the same path inside and outside.
- `docker run --rm` deletes the container before its OOM flag can be read. Create without `--rm`, inspect after exit, then remove.
- Parameters go in on stdin and environment values are passed by name (`-e NAME` with the value in the docker CLI's own environment), so nothing sensitive appears in a process list.

## Requirements

- Every endpoint except `GET /health` requires `Authorization: Bearer <RUNNER_TOKEN>`, compared in constant time. With `RUNNER_TLS_CERT` and `RUNNER_TLS_KEY` set the agent serves HTTPS; in production it refuses to start without them.
- A run container is started with: `--network <sandbox>`, `--dns 1.1.1.1`, `--read-only`, `--tmpfs /tmp:rw,size=64m`, `--memory` and `--memory-swap` equal, `--cpus 1`, `--pids-limit 128`, `--ulimit nofile=1024:1024`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--user 10001:10001`, source mounted read-only at `/fn`.
- The agent enforces the timeout itself with `docker kill`, caps streamed output at 1 MB, and reports one of `SUCCEEDED`, `FAILED`, `TIMED_OUT`, `CANCELED`, with `oomKilled` when the kernel killed it.
- Admission: the sum of running containers' memory limits stays at or below `RUNNER_MEMORY_BUDGET_MB` (default 2560); otherwise the agent answers 429.
- At startup the agent removes leftover `fn-*` containers and work directories, and builds the runtime images when their tag is missing.
- `inspect` never executes user code.

## Architecture

Agent API:

| Route | Body | Answer |
|-------|------|--------|
| `GET /health` | | `{ ok, runtimes: [{ id, image, ready }] }` |
| `POST /inspect` | `{ runtime, source }` | `{ schema }` or `{ error }` |
| `POST /runs` | `{ runId, runtime, files, params, env, timeoutSeconds, memoryMb, depsKey? }` | NDJSON stream of events |
| `DELETE /runs/:runId` | | 204; the stream ends with `CANCELED` |

Events: `{ type: "started" }`, `{ type: "output", stream, data }`, `{ type: "exit", status, exitCode, oomKilled, truncated, result?, error?, durationMs }`.

Runtimes:

| Id | Base image | Entry file | Call |
|----|-----------|-----------|------|
| `NODE` | `node:24-bookworm-slim` | `index.ts`, `index.mts`, `index.js` or `index.mjs` | `main(...args)` in schema order |
| `PYTHON` | `python:3.13-slim-bookworm` | `main.py` | `main(**params)` |

Debian-slim bases are used because musl breaks many prebuilt Python wheels. Each image adds user 10001 and a wrapper under `/opt/fn`. The image tag is the hash of its `runtimes/<id>` directory, so a wrapper change produces a new image.

Wrapper: read params from stdin, import the entry file, call `main` (awaiting a promise or coroutine), print an uncaught error's traceback to stderr and exit 1, and finally print one line `<marker> <json>` where the marker is a random per-run value from `FN_RESULT_MARKER`. The agent removes that line from the output and returns the JSON as `result` (at most 256 KB; a value that cannot be serialized is an error).

Parameter schema (`inspect`):

- TypeScript and JavaScript: parse with the `typescript` compiler's `createSourceFile` in the agent process. Find the exported `main` (function declaration or arrow function constant).
- Python: run `/opt/fn/read_params.py` (named so it cannot shadow the standard `inspect` module; both Python commands also pass `-P`) in the Python image with `--network none`; it uses `ast` only, and reads defaults with `ast.literal_eval`.
- Mapping: `string`/`str` to string; `number`/`float` to number; `int` to integer; `boolean`/`bool` to boolean; `string[]`/`list[str]` and numeric lists to arrays; a union of string literals or `Literal[...]` to an enum; a default makes the field optional and prefilled; `?`, `| None` or `Optional` makes it optional; anything else becomes an untyped field edited as JSON. An untyped JavaScript parameter takes the type of its default, else string.
- Output: `{ type: "object", properties, required, "x-order": [names] }`. A destructured or rest parameter, or a missing `main`, returns an error message naming the problem.

## Related Code Files

- Create: `apps/runner/package.json` (`@repo/runner-app`), `tsconfig.json`, `tsup.config.ts`, `env.ts`
- Create: `apps/runner/src/index.ts`, `auth.ts`, `docker-cli.ts`, `run-container.ts`, `output.ts`, `admission.ts`, `app.ts`, `workspace.ts`, `runtime-images.ts`, `inspect-typescript.ts`, `inspect-python.ts`, `protocol.ts`
- Create: `apps/runner/runtimes/node/Dockerfile`, `wrapper.mjs`; `apps/runner/runtimes/python/Dockerfile`, `wrapper.py`, `read_params.py`
- Create: unit tests beside `inspect-typescript.ts`, `output.ts`, `protocol.ts`, `admission.ts`, `auth.ts`
- Create: `apps/runner/integration/run.integration.test.ts`, `inspect.integration.test.ts` (need local Docker)
- Modify: `Dockerfile` (new `runner-agent` target with `docker-cli`), `scripts/docker/validate-production-runtimes.mjs`
- Modify: `.env.example`, `turbo.json` (`RUNNER_TOKEN`, `RUNNER_PORT`, `RUNNER_WORK_DIR`, `RUNNER_SANDBOX_NETWORK`, `RUNNER_MEMORY_BUDGET_MB`, `RUNNER_TLS_CERT`, `RUNNER_TLS_KEY`)

## Implementation Steps

1. Scaffold `apps/runner` after `apps/api`: Hono on `@hono/node-server`, typed env, tsup build, port 3003 in development.
2. Write `docker-cli.ts`: spawn `docker` without a shell, stream stdout and stderr, stop on abort. Write `runtime-images.ts` to build missing images at startup and report readiness in `/health`.
3. Write the two runtime images and wrappers.
4. Write `run-container.ts`: write files into `<work>/<runId>/src` (reject absolute paths and `..`), create and start the container, pipe params to stdin, stream through `output.ts`, enforce the timeout, inspect for OOM, remove the container and directory in `finally`.
5. Write `admission.ts`, the `DELETE` handler and the startup sweep.
6. Write both inspectors and their unit tests, including every mapping row above.
7. Write the integration tests listed under Success Criteria.
8. Add the `runner-agent` Dockerfile target and extend the runtime validation script.

## Todo

- [x] App scaffold, auth and health
- [x] Runtime images and wrappers
- [x] Run, timeout, cancel, output cap, OOM detection
- [x] Admission and startup sweep
- [x] TypeScript and Python inspectors
- [x] Unit and integration tests
- [x] Dockerfile target

## Success Criteria

Integration tests against local Docker prove:

- A Node/TypeScript and a Python function with two files each return their `main` result and stream stdout and stderr in order.
- An infinite loop ends as `TIMED_OUT` at the timeout and as `CANCELED` on `DELETE`; no container or work directory remains.
- Allocating past the memory limit ends as `FAILED` with `oomKilled: true`.
- Printing 5 MB yields 1 MB of output and `truncated: true`.
- Inside the container: the user is 10001, writing outside `/tmp` fails, the environment holds only the passed variables and the marker, and `/proc/1/environ` is the container's own.
- A request without the token gets 401; a request over the memory budget gets 429.
- `pnpm --filter @repo/runner-app test` and `check-types` pass.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Docker Desktop behaves differently from Linux Docker | Resource and filesystem tests run locally; the network filter is tested on the VM in phases 1 and 8 |
| Base image pulls fail at startup | `/health` reports the runtime as not ready and runs for it answer 503; the agent keeps serving the other runtime |
| A wrapper bug leaks the marker line | Unit test the framing with output that ends without a newline and with a forged marker |

## Security Considerations

- The token and TLS key are read from the environment and files, never logged. Request bodies (source, params, env values) are not logged.
- File paths from the request are validated before anything is written.

## Next Steps

Phase 3 writes the client for this protocol. Phase 6 adds `POST /deps`.
