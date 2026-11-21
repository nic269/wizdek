---
title: Plan Wizdek Functions on a dedicated runner VM
date: 2026-11-17
summary: Brainstormed and planned a Lambda-style script runner; no code or infrastructure changed.
---

# Plan Wizdek Functions on a dedicated runner VM

## What happened

- Brainstormed a "Functions" feature for Wizdek: a multi-file editor for Node.js/TypeScript and Python functions that run on the server by hand, over HTTP or on a schedule.
- Wrote the plan at `plans/261117-0635-wizdek-functions-runner/` (`plan.md` and eight phases); `ak plan validate` passes.
- Measured the production VMs over read-only SSH: apps-prod uses 2.0 of 8 GiB, db-prod 0.6 of 6 GiB, deploy 1.2 of 4 GiB. The Proxmox host refused the assistant's key, so thin-pool usage is still unread.

## Decisions

- User code never runs in the API container. A child process with the same uid can read the API's environment, which holds the database URL and the secret encryption key.
- A new `runner` VM (VMID 150, 10.10.10.50, 2 vCPU, 4 GiB, 32 GiB) owns Docker. Each run is one hardened container on a network that reaches the internet but no private range.
- No hardware upgrade. Removing the unused `openclaw` VM frees the RAM and disk the runner needs.
- The API calls the runner agent directly over TLS with a bearer token and streams output into the run row; the job queue only fires schedules.
- Parameters come from parsing `main` (TypeScript parser, Python `ast`), never from executing it.
- Packages install per function in a build container and are cached by manifest hash.
- The HTTP trigger is `POST /api/fn/{functionId}` with one header token per function, hashed at rest. The Cloudflare tunnel does not authenticate callers.

## Findings that changed the design

- The Next rewrite's `proxyTimeout` is 30 seconds, so the 90-second synchronous trigger wait needs it raised to 95 seconds.
- Docker-published ports bypass ufw, so the agent port needs a `DOCKER-USER` rule or host networking.
- Decision 0001 excluded arbitrary code and 0005 rejected `docker run`; a decision 0006 must explain why this feature differs.

## Next steps

- The owner grants a Proxmox key and approves each infrastructure step when phase 1 starts.
- Phases 2 to 7 can start on a developer machine against local Docker.
- How the agent gets the Docker socket under Coolify is verified in phase 8, with a systemd fallback.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
