---
title: "Functions: Lambda-style script runner"
description: "Add a Functions page where an organization writes Node.js/TypeScript and Python functions in a multi-file editor and runs them in one-shot containers on a dedicated runner VM, by hand, over HTTP or on a schedule."
status: done
priority: P1
effort: 17.5d
branch: feat/functions-runner
tags: [feature, backend, frontend, api, database, infra]
blockedBy: []
blocks: []
created: 2026-11-17
---

# Functions: Lambda-style script runner

## Overview

Add a Functions page where an organization writes Node.js/TypeScript and Python functions in a multi-file editor and runs them in one-shot containers on a dedicated runner VM, by hand, over HTTP or on a schedule. A function is a small folder of files with a `main` entry point; its parameters become form fields, its packages are installed from `package.json` or `requirements.txt`, and every run records output, result, exit code and duration.

Paths in phase files are relative to this repository unless they start with `infra:`, which means `/Volumes/anh.nguyen/Projects/wizloft/wizloft-infrastructure`.

## Accepted Decisions

| Area | Decision |
|------|----------|
| Where code runs | A new `runner` VM on the Proxmox host (VMID 150, 10.10.10.50, 2 vCPU, 4 GiB, 32 GiB). Never in the API container, which holds `DATABASE_URL` and the secret encryption key. |
| Isolation | One container per run: read-only root, tmpfs `/tmp`, non-root, all capabilities dropped, memory/CPU/pids limits, timeout. Rejected: a process in the API container (same uid can read the API's environment), Firecracker (operational cost), real AWS Lambda (kept possible behind the runner interface). |
| Network | Sandbox containers reach the internet but not the LAN, other private ranges or Tailscale. The runner agent is reachable only from apps-prod, over TLS with a bearer token. |
| Capacity | Remove the unused `openclaw` VM (4 GiB, 32 GiB) to make room. No hardware purchase. Measured 2026-11-17: apps-prod 2.0/8 GiB, db-prod 0.6/6 GiB, deploy 1.2/4 GiB in use. |
| Execution path | The API calls the runner directly and streams output into the run row; the UI polls. The job queue is used only to fire schedules. |
| Parameters | Typed positional parameters of `main`, read by parsing (never executing) the entry file, stored as JSON Schema. |
| Packages | Installed per function in a separate build container, cached by manifest hash, mounted read-only into runs. |
| Editor | Monaco (already shipped with GraphiQL 5) with a file tree and tabs. Rejected: embedding code-server (a standing server with a terminal on the runner). |
| HTTP trigger | `POST /api/fn/{functionId}` on the existing public origin, one token per function in a header, hashed at rest. No new tunnel route. Cloudflare Access can be added later. |
| Access | New `functions` permission module (`read`, `manage`, `run`), Owner and Admin only by default. |
| Built-in helpers | A preinstalled `wizdek` module lets scripts query and write granted databases and run Shopify GraphQL on granted stores. Credentials stay in wizdek-api; the sandbox holds a token valid only for its run and reaches wizdek-api over one LAN firewall exception. PROD database writes and Shopify mutations are allowed through a per-function grant (decided 2026-11-21). |

## Limits

| Item | Value |
|------|-------|
| Source | 50 files, 256 KB per file, 1 MB per function |
| Timeout | default 60 s, maximum 900 s |
| Memory | 128, 256 (default), 512 or 1024 MB; 1 CPU; 128 processes |
| Output / result | 1 MB of output stored, then truncated; result JSON up to 256 KB |
| Runner admission | running containers' memory limits sum to at most 2560 MB; beyond that the runner answers busy |
| Dependency cache | 500 MB per manifest hash; install timeout 300 s |
| HTTP invoke | body 1 MB; waits 90 s, then answers 202 with the run id; 60 requests per minute per function |
| History | newest 200 runs per function |
| Schedules / env vars | 5 schedules per function, at most one firing a minute; 50 variables, 8 KB per value |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Runner VM and Network Isolation](./phase-01-runner-vm-and-network-isolation.md) | Done |
| 2 | [Phase 2: Runner Agent and Runtime Images](./phase-02-runner-agent-and-runtime-images.md) | Completed |
| 3 | [Phase 3: Data Model, Permissions and Services](./phase-03-data-model-permissions-and-services.md) | Completed |
| 4 | [Phase 4: API Contracts and Routers](./phase-04-api-contracts-and-routers.md) | Completed |
| 5 | [Phase 5: Functions UI and Editor](./phase-05-functions-ui-and-editor.md) | Completed |
| 6 | [Phase 6: Package Install and Cache](./phase-06-package-install-and-cache.md) | Completed |
| 7 | [Phase 7: Triggers, Schedules and Env Vars](./phase-07-triggers-schedules-and-env-vars.md) | Completed |
| 8 | [Phase 8: Built-in Helpers for Databases and Shopify Stores](./phase-08-built-in-helpers.md) | Completed |
| 9 | [Phase 9: Deploy, Docs and Release Check](./phase-09-deploy-docs-and-release-check.md) | Done |

Phase 1 changes infrastructure and waits for the owner's approval and a Proxmox key; it blocks only phase 9. Phases 2 to 7 are built and tested on a developer machine against a local agent and local Docker. Phase 3 needs 2. Phase 4 needs 3. Phase 5 needs 4. Phase 6 needs 2, 4 and 5. Phase 7 needs 4 and 5. Phase 8 needs 4 to 7. Phase 9 needs all.

## Non-Goals

- Firecracker or other microVMs, warm pools, layers, versions and aliases, autoscaling, an AWS Lambda adapter.
- Editor extensions, an integrated terminal, a debugger, Python IntelliSense, types for installed packages.
- A code node inside flows. Passing Shopify store tokens or database connection strings into the sandbox (phase 8 brokers calls through wizdek-api instead).
- Database engines other than PostgreSQL in the helpers; Shopify bulk operations, per-function key-value state and file artifacts in the SDK (candidates for later).
- Private package registries. Cloudflare Access in front of the HTTP trigger.
- A sandbox hardened against hostile public tenants. See Threat Model.

## Threat Model

- **What runs:** code written by Owners and Admins of an organization, and packages they pull from public registries. Package install scripts are treated as untrusted code.
- **What must stay out of reach:** the API's secrets (database URL, encryption key, auth secret), stored database URLs and Shopify tokens, other organizations' data, and every host on the LAN (Proxmox, Coolify, db-prod, apps-prod, infra, the router), except the runtime port of wizdek-api.
- **Granted resources:** a function can read and write the databases and stores granted to it, including PROD, by design. The grant list and the audit log are the controls.
- **Boundaries:** a separate VM (KVM) between user code and production containers; a container per run between functions; an egress filter between containers and private networks; TLS plus a bearer token between the API and the agent.
- **Accepted:** containers on the runner share its kernel, so a kernel escape reaches the runner VM, which holds no Wizdek secret at rest (function secrets pass through it only for the duration of a run). Functions use the home connection's public IP for outbound requests. Revisit both before serving organizations that are not trusted.
- **Public surface:** the HTTP trigger is public. Anyone with the URL can call it; only the per-function token authorizes a run. Refusals carry no reason.

## Success Criteria

- [x] A multi-file Node/TypeScript function and a Python function can be created, saved and reopened in the editor with a file tree and tabs. (production 2026-11-21)
- [x] `main(orderId: string, limit: number = 10, dryRun: boolean = false)` produces three typed fields with defaults; changing the signature and saving updates the form. (production)
- [x] A run shows stdout and stderr, the JSON return value, exit code and duration; a failing run shows its traceback; history lists past runs. (production)
- [x] Timeout and Cancel stop an infinite loop; output is cut at 1 MB; a script that over-allocates is killed by its memory limit. (production; the memory kill reports exit code 137 rather than naming the limit)
- [x] A function with `package.json`, and one with `requirements.txt`, installs and imports its packages; a second run reuses the cache; changing the manifest rebuilds. (production: install and cache reuse; rebuild on a changed manifest by `deps.integration.test.ts`)
- [x] On the runner VM, a script that prints its environment, reads `/proc` and probes 10.10.10.0/24 finds no Wizdek secret and reaches no LAN host. (production)
- [x] An HTTP call with the right token runs the function and returns its result; a missing or wrong token gets 401 and creates no run; a call longer than 90 s returns 202 with a run id. (production)
- [x] A schedule starts runs at the expected minutes and stops when disabled. (production)
- [x] Env var values reach the run, are never returned by any API, are scrubbed from stored output, and are absent during package install. (production: reach the run and are redacted; never returned and absent from installs by integration tests)
- [x] Without `functions:run` the API answers 403; for another organization 404; each manual run and each trigger, schedule or variable change has an audit entry. (integration tests; production audit entries checked, no member account was used in production)
- [x] With no runner configured the page shows a not-enabled state and nothing errors. (integration and E2E tests)
- [x] A function reads and writes a granted database and runs a Shopify query and mutation on a granted store through the `wizdek` module, with no credential in the sandbox; an ungranted alias gets 403 and a finished run's token gets 401. (integration tests; not run in production, where the owner ruled out testing against production stores)
- [x] `pnpm release:check` passes. (on merged main, except lint of the owner's untracked `docs/design/wizdek-scale-preview/`)

## Open Items

- The owner grants a Proxmox key and approves each infrastructure step when phase 1 starts.
- How the agent container gets the Docker socket under Coolify is verified in phase 9, with a systemd fallback.
- Phase 8 adds infrastructure: an egress exception from `fn-sandbox` to 10.10.10.30:3004, and a published port on apps-prod restricted to 10.10.10.50. Both need the owner's approval with phases 1 and 9.

<!-- slug: wizdek-functions-runner -->
