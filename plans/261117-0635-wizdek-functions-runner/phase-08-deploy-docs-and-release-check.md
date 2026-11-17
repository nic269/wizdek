---
phase: 8
title: "Phase 8: Deploy, Docs and Release Check"
status: todo
priority: P1
effort: "1.5d"
dependencies: [1, 2, 3, 4, 5, 6, 7]
---

# Phase 8: Deploy, Docs and Release Check

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
5. Take the pgBackRest diff backup; apply the three migrations following the release procedure in the build log; run `pnpm db:sync-roles` against production.
6. Add the two variables to the API in `wizdek.py`, run it, and deploy API and app with `deploy.sh`.
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
- `docs/decisions/0006-functions-on-a-dedicated-runner-vm.md`: context, the decision, alternatives rejected (process in the API container, Firecracker, real Lambda, code-server), why this differs from the "arbitrary-code node" exclusion in 0001 and the `docker run` rejection in 0005, what was verified, behaviour to know about (shared kernel, home IP for egress, runs lost on API restart, the Monaco spike result), and when to revisit.
- `docs/architecture.md`: a Functions section (packages, agent protocol, execution path, trigger route) and the new row in the system-shape table; the permissions list.
- `docs/README.md` index rows; `README.md` setup note for running the agent locally.

## Todo

- [ ] Release check green before deploy
- [ ] Agent deployed; health and port restriction verified
- [ ] Egress probe repeated
- [ ] Backup, migrations, role sync
- [ ] API and app deployed with the feature on
- [ ] Production verification table complete
- [ ] Docs written and links checked
- [ ] Build log updated

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

## Next Steps

Possible follow-ups, not part of this plan: Cloudflare Access in front of the trigger, an AWS Lambda backend behind `FunctionRunner`, gVisor as the container runtime.
