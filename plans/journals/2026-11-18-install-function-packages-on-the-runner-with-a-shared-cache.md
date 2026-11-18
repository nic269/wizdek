---
title: Install function packages on the runner with a shared cache
date: 2026-11-18
summary: "Functions install package.json/requirements.txt packages in a sandboxed build container, cached by manifest hash and mounted read-only into runs."
---

# Install function packages on the runner with a shared cache

## What happened
Built package installs for Wizdek functions. The runner agent gained `POST /deps`, which streams an npm or pip install from a container with the run's hardening, a writable `/deps` mount, 1024 MB and a 300 s timeout. Each result lands in a cache entry keyed by runtime image plus manifests. Runs mount it read-only (`/fn/node_modules`, or `/deps` with `PYTHONPATH`). The API saves trigger an install only when the manifest hash changes; runs are refused while installing or after a failure; an evicted entry is reinstalled and the run retried once.

## Decisions
- Cache key includes the image tag so a new base image rebuilds native modules.
- Commit is temp dir + marker + rename, so a crashed install is never mounted; eviction removes the marker first.
- Installs run as the agent's own uid so eviction can delete the files; a root agent chowns the dir to the sandbox user.
- `depsHash` on the function guards against a late install overwriting newer manifests' status.
- On a cache hit the agent writes one explanatory line; an empty log looked like a failure.

## Found along the way
- Selecting the already-shown run in History left the Output tab stuck on "Loading the run…" (fixed).
- Node printed MODULE_TYPELESS_PACKAGE_JSON for any package.json without "type"; silenced in the run command.

## Evidence
Runner integration on local Docker installs `ms` and `six`, enforces the size cap, keeps no failed entry, and shows the install env holds no runner token. Browser test passed against the real runner and the fake; full e2e 36 passed / 10 skipped.

## Next steps
Phase 7: HTTP trigger, schedules, encrypted env vars (kept out of installs by design).

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
