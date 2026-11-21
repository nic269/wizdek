---
phase: 9
title: "Phase 9: Deploy, Docs and Release Check"
status: done
priority: P1
effort: "1.5d"
dependencies: [1, 2, 3, 4, 5, 6, 7, 8]
---

# Phase 9: Deploy, Docs and Release Check

## Context Links

- Deploy configuration and procedure: `infra:scripts/coolify/wizdek.py`, `infra:scripts/coolify/deploy.sh`, `infra:docs/build-log.md` (Wizdek release record; "neither runtime image automatically applies migrations")
- How apps-prod was added to Coolify with a restricted root key: `infra:docs/build-log.md` (deploy, apps-prod)
- Docs to update: `docs/README.md`, `docs/architecture.md`, `docs/decisions/`, `README.md`
- Decisions this feature revisits: `docs/decisions/0001-toolkit-architecture.md` (arbitrary code out of scope), `0005-database-backups-with-native-dump-tools.md` (`docker run` rejected)

## Overview

Deploy the agent to the runner VM, turn the feature on in production, verify every success criterion on the real system, and write the documentation.

## Key Insights

- The agent needs the Docker socket and a work directory mounted at the same path inside and outside its container. Whether Coolify can express that for a Dockerfile app is unverified; a directory bind mount is already proven by the Wizdek storage mount.
- Docker-published ports bypass ufw. The port restriction from phase 1 must be re-checked once the real agent is listening.
- Unsetting `FUNCTIONS_RUNNER_URL` turns the feature off without a rollback of code or schema.

## Requirements

- The agent runs on the runner VM from the `runner-agent` image, restarts on boot, serves HTTPS with the phase 1 certificate, and holds only its token, TLS files and paths.
- The API publishes its runtime port as `10.10.10.30:3004` and gets `FUNCTIONS_RUNTIME_URL=http://10.10.10.30:3004`. apps-prod's `DOCKER-USER` chain accepts 3004 only from 10.10.10.50; every other source is dropped.
- The API gets `FUNCTIONS_RUNNER_URL=https://runner.wizloft.dev:8443` and `FUNCTIONS_RUNNER_TOKEN` as runtime-only variables. The token is generated on the owner's Mac into `~/.config/wizloft/wizdek-secrets.env` and never printed.
- A pgBackRest diff backup is taken before the migrations are applied.
- Existing organizations receive the new permissions through `pnpm db:sync-roles`.
- Every infrastructure step is approved by the owner when it is reached.

## Related Code Files

- Modify: `infra:scripts/coolify/wizdek.py` (runner app or its fallback; the two API variables)
- Create: `infra:scripts/runner/deploy-agent.sh` only if the systemd fallback is used
- Modify: `infra:docs/build-log.md`
- Create: `docs/functions.md`, `docs/decisions/0006-functions-on-a-dedicated-runner-vm.md`
- Modify: `docs/architecture.md`, `docs/README.md`, `README.md`

## Implementation Steps

1. Run `pnpm release:check` on the feature branch; fix what it finds.
2. Decide the agent's deployment, in this order of preference, and record the choice:
   a. Coolify app `wizdek-runner` on a new Coolify server for the runner VM (root key accepted only from 10.10.10.20, as on apps-prod), with host networking or a published port, the socket and `/var/lib/fn-runner` mounted.
   b. If Coolify cannot mount the socket or set the network mode for a Dockerfile app: a Docker Compose resource in Coolify.
   c. If neither works: build the image on the runner from a release archive and run it under a systemd unit, driven by `deploy-agent.sh`.
3. Deploy the agent. From apps-prod, `GET /health` over HTTPS verifies against the private CA and reports both runtimes ready. From another LAN host the port refuses.
4. Re-run `infra:scripts/runner/probe-egress.sh` with the agent running.
5. Take the pgBackRest diff backup; apply the four migrations following the release procedure in the build log; run `pnpm db:sync-roles` against production.
6. Add the variables and the `10.10.10.30:3004` port mapping to the API in `wizdek.py`, add the `DOCKER-USER` rule on apps-prod (owner approval), run it, and deploy API and app with `deploy.sh`.
7. Verify in production (table below).
8. Write the docs, then run `pnpm release:check` again.
9. Record the release in `infra:docs/build-log.md`.

Production verification on `https://tools.wizloft.dev`:

| Check | Expected |
|-------|----------|
| Create, save, reopen a TypeScript and a Python function with two files | Files and tabs persist |
| Sample signature | Three typed fields; changing it changes the form |
| Run, failing run, history | Output, result, exit code, duration; traceback; rows |
| Infinite loop with Cancel and with timeout; 5 MB of output; over-allocation | Stopped; truncated; killed by memory limit |
| Function with `package.json`; with `requirements.txt` | Installs, runs, second run reuses the cache |
| Hostile script: print env, read `/proc/1/environ`, connect to each address in the phase 1 probe table | No Wizdek secret; no connection |
| `curl` the trigger with and without the token | Result; 401 and no run |
| An 80-second function through the trigger; a 120-second one | 200 after about 80 s; 202 at 90 s, result later through the run route |
| Schedule every minute, then disabled | Runs start; then stop |
| Variable printed by a function | `[redacted]` in output |
| Member account | No Functions data; API 403 |

## Documentation

- `docs/functions.md`: writing a function (`main`, supported parameter types, entry files, TypeScript limits), packages, running and history, the HTTP trigger with a `curl` example, schedules, variables, permissions, limits, what a function can and cannot reach.
- `docs/decisions/0006-functions-on-a-dedicated-runner-vm.md`: context, the decision, alternatives rejected (process in the API container, Firecracker, real Lambda, code-server), why this differs from the "arbitrary-code node" exclusion in 0001 and the `docker run` rejection in 0005, what was verified, behaviour to know about (shared kernel, home IP for egress, runs lost on API restart, the Monaco spike result), the built-in helpers (credentials stay in wizdek-api, run-scoped token, per-function grants, PROD writes allowed, the one LAN exception), and when to revisit.
- `docs/architecture.md`: a Functions section (packages, agent protocol, execution path, trigger route) and the new row in the system-shape table; the permissions list.
- `docs/README.md` index rows; `README.md` setup note for running the agent locally.

## Todo

- [x] Release check green before deploy
- [x] Agent deployed; health and port restriction verified
- [x] Egress probe repeated
- [x] Backup, migrations, role sync
- [x] API and app deployed with the feature on
- [x] Production verification table complete
- [x] Docs written and links checked
- [x] Build log updated

## Success Criteria

- Every row of the verification table holds, and each plan-level success criterion in `plan.md` is ticked with its evidence.
- `pnpm release:check` passes on the final commit.
- The docs' claims match the deployed behaviour, and their links resolve.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Coolify gains root on the runner VM | Same restriction as apps-prod (key accepted only from the deploy VM); the runner holds no application secret |
| A migration fails in production | Additive migrations only; diff backup first; the feature stays off until they apply |
| The feature misbehaves after release | Unset `FUNCTIONS_RUNNER_URL` and redeploy the API; pages show the not-enabled state |

## Security Considerations

- The runner token is created with a non-echoing command and passed only through the secrets file and Coolify's runtime variables.
- The hostile-script check is the release gate for the isolation claims; the release does not proceed if any address in the probe table answers.

## Progress (2026-11-21)

Done in the repository, before any infrastructure step:

- `pnpm release:check`: lint failed on three files. Two were this branch's tests (a format slip and an inline regex in the e2e spec, a shadowed name in the runtime test) and are fixed. The third is the untracked `docs/design/wizdek-scale-preview/index.html`, which belongs to the owner and was left alone, so the full command stays red until it is formatted, committed elsewhere or ignored. With it excluded, lint, type checks, tests, boundaries and the build pass.
- The API's helper port moved from 3003 to 3004: the local runner agent already listens on 3003 (`RUNNER_PORT`, `FUNCTIONS_RUNNER_URL=http://127.0.0.1:3003`), so the API could not have bound both on a developer machine. Phases 1, 8 and 9 and `.env.example` now say 3004; production uses the same number.
- Written: `docs/functions.md`, `docs/decisions/0006-functions-on-a-dedicated-runner-vm.md`, a Functions section and two system-shape rows in `docs/architecture.md`, index rows in `docs/README.md`, and a Functions setup section in `README.md`. Decision 0006 marks the runner-VM probe as pending.

Waiting: phase 1 (owner approval and a Proxmox key), then steps 2 to 7 and 9 of this phase.

## Release (2026-11-21)

- `feat/functions-runner` merged into `main` (`5d37db5`). Three E2E files conflicted because main and the branch had each written mobile-navigation helpers; main's helpers were kept with the branch's runner and API test setup. On merged main a runner unit test failed only under the full parallel run: it backdated a cache entry while `acquire()`'s un-awaited touch could still land; the test now waits for the touch (`e9bd02c`). Types, tests, boundaries and build pass; lint is red only for the owner's untracked `docs/design/wizdek-scale-preview/`. Pushed to `origin/main`.
- Agent: option c, chosen by the owner (Coolify would need root SSH on the runner and would install its proxy there). `infra:scripts/runner/deploy-agent.sh` builds the image on the runner from a `git archive` and runs it with host networking on 8443 and `RUNNER_SANDBOX_NETWORK=fn-sandbox`; the agent's default network is Docker's unfiltered `bridge`. From apps-prod, `/health` verifies against the private CA and reports both runtimes ready; deploy and the owner's Mac are refused. The probe passed again with the agent running.
- Database: pgBackRest diff `20261115-020001F_20261121-234648D`, then the four migrations from a one-off `node:24-alpine` container on apps-prod (URL through an env file, never on a command line), then `db:sync-roles` for 108 organizations. Owner and Admin hold `functions:read|manage|run` in all of them.
- API: `infra:scripts/runner/setup-helper-port.sh` on apps-prod (DOCKER-USER admits only 10.10.10.50 to 10.10.10.30:3004, reapplied by a systemd unit), `wizdek.py` adds the four `FUNCTIONS_*` variables and the `10.10.10.30:3004:3004` mapping to the API only, then both apps deployed. A sandbox container reaches the helper port (401 without a token) but not 3002; deploy and the Mac are refused on 3004.
- Production verification, in the `wizloft` organization with functions named `release-check-*`, deleted afterwards. The owner ruled out tests against production stores, so no grant was added and the `wizdek` helpers were not called.

| Check | Result |
|-------|--------|
| Create, save, reopen; two files in each runtime | TypeScript created in the UI, edited to two files; Python with two files; both reopened with their files |
| Sample signature | Three typed fields with defaults; a new signature gave `orderId` and a `"fast" \| "slow"` choice |
| Run, failing run, history | Output, result, exit code, duration; the failure shows its stack; history lists the runs |
| Loop with timeout and with Cancel; 5 MB output; over-allocation | TIMED_OUT at 5 s; CANCELED; cut at 1 MB with `truncated`; killed with exit 137 (the message does not name the memory limit) |
| `package.json`, `requirements.txt` | `dayjs` and `six` installed and imported; one cache entry each on the runner, reused by the second run |
| Hostile script | Environment holds only the run's `WIZDEK_*` values and its variable; `/proc` shows two processes and no secret; every probe-table address, 3002 and the metadata address unreachable; 3004 open; internet 200; code read-only; uid 10001 |
| Trigger with and without the token | 200 with the result (header and Bearer); empty 401 without or with a wrong token, and no run |
| 80 s and 120 s through the trigger | 200 after 80 s; 202 at 90 s with a run id, whose route then returned the result; that route answers 401 without the token |
| Schedule every minute, then disabled | Runs at 16:59:29 and 17:00:29 UTC; none after disabling |
| Variable printed | `[redacted]` in the stored output |
| Member account | Not run in production (no member session); covered by the API integration tests |
| Audit | `function.created`, `files_saved`, `updated`, `env.set`, `http.enabled`, `http.rotated`, `run.started`, `run.canceled`, `schedule.created`, `schedule.updated` recorded |

Follow-up worth considering: report a memory-limit kill as such (Docker's `OOMKilled`) instead of the bare exit code.

## Next Steps

Possible follow-ups, not part of this plan: Cloudflare Access in front of the trigger, an AWS Lambda backend behind `FunctionRunner`, gVisor as the container runtime.
