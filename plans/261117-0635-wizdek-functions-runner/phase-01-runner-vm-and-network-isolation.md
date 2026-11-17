---
phase: 1
title: "Phase 1: Runner VM and Network Isolation"
status: todo
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Runner VM and Network Isolation

## Context Links

- What is running today: `infra:docs/build-log.md`
- VM creation: `infra:scripts/pve/create-template.sh`, `infra:scripts/pve/create-vms.sh` (existing VMIDs are skipped, never modified)
- Guest baseline: `infra:scripts/vm/baseline.sh`
- Private CA: `infra:scripts/db/setup-ca.sh` (the CA key stays on db-prod, root-only)
- Approval rule: `infra:README.md` ("Explicit user approval is required before every infrastructure-changing stage")

## Overview

Free the capacity held by the unused `openclaw` VM, create the `runner` VM, and prove that a container on it reaches the internet but nothing private. This phase changes infrastructure, so every step that mutates the host waits for the owner's approval and the Proxmox key the owner will grant.

## Key Insights

- Guest RAM is fixed (`--balloon 0`), so the budget is about allocation, not usage. Allocated today: infra 4, deploy 4, apps-prod 8, db-prod 6 = 22 GiB, plus `openclaw` 4 GiB (stopped, `onboot=1`), on a 31.0 GiB host that itself uses about 2 GiB.
- `local-lvm` has 348.8 GiB with 283.5 GiB committed. Removing `openclaw` (32 GiB) and adding `runner` (32 GiB) keeps commitment unchanged.
- The Proxmox host refused the assistant's key on 2026-11-17, so thin-pool usage and the `openclaw` boot setting are still unread. Read them first.
- Docker publishes ports with its own firewall rules, which ufw does not see. The agent port needs a rule in `DOCKER-USER` or host networking; "ufw allow from 10.10.10.30" alone is not enough.
- Traffic from a container to another network goes through `FORWARD` (`DOCKER-USER`); traffic to the runner host's own addresses goes through `INPUT`. Both need rules.

## Requirements

- `openclaw` (VMID 100) is backed up, then removed, only after the owner confirms at execution time.
- `runner`: VMID 150, 2 vCPU, 4096 MB, 32 GiB, 10.10.10.50, boot order 4, tags `functions;docker`, created by the existing script.
- Docker Engine with log rotation and an address pool that overlaps neither the LAN nor apps-prod's pool: `10.210.0.0/16`.
- A bridge network `fn-sandbox` (10.210.1.0/24), IPv6 off, inter-container communication off.
- From `fn-sandbox`: allowed to public IPv4 addresses; dropped to 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16 and to every address of the runner host. Rules survive a reboot and a Docker restart.
- Agent port 8443 answers only to 10.10.10.30.
- A TLS certificate for `runner.wizloft.dev` (SAN also `IP:10.10.10.50`) signed by the existing private CA, and a DNS-only A record `runner.wizloft.dev` to 10.10.10.50.
- `infra` (VMID 101), the host network and the tunnel are not touched.

## Architecture

```text
wizdek-api (apps-prod 10.10.10.30) --HTTPS 8443 + bearer--> runner agent (10.10.10.50)
                                                              |  docker run / kill
                                                              v
                                              fn-sandbox 10.210.1.0/24 (one container per run)
                                                              |  DOCKER-USER: drop private ranges
                                                              v
                                                           internet
```

## Related Code Files

- Modify: `infra:scripts/pve/create-vms.sh` (add the `150 runner` row)
- Create: `infra:scripts/runner/setup-docker.sh` (Docker Engine, daemon.json, `fn-sandbox`)
- Create: `infra:scripts/runner/setup-egress.sh` (iptables rules and a systemd unit that reapplies them after `docker.service`)
- Create: `infra:scripts/runner/issue-cert.sh` (key and CSR on the runner, signed on db-prod)
- Create: `infra:scripts/runner/probe-egress.sh` (the reachability test below)
- Modify: `infra:docs/build-log.md`

## Implementation Steps

1. Gate: obtain the owner's approval and the Proxmox key. Record `qm list`, `pvesm status`, `lvs` and `qm config 100` before any change.
2. Back up `openclaw` with `vzdump 100 --storage local --mode stop --compress zstd`, confirm the archive exists, then ask the owner to confirm removal and run `qm destroy 100 --purge`. Removal cannot be undone except from that archive.
3. Add the `150 runner` row to `create-vms.sh` and run it on the host. The owner adds the DHCP reservation for the new MAC and an SSH alias `wiz-runner`.
4. Run `baseline.sh` with `SWAP_GB=2`.
5. Run `setup-docker.sh`: install Docker Engine, write `daemon.json` (log rotation, `default-address-pools` 10.210.0.0/16), create `fn-sandbox` with `com.docker.network.bridge.enable_icc=false`.
6. Run `setup-egress.sh`: insert the `DOCKER-USER` drops for the private ranges and an `INPUT` drop for source 10.210.1.0/24; restrict 8443 to source 10.10.10.30; install the systemd unit.
7. Run `issue-cert.sh`; the owner adds the DNS-only A record. Install the certificate and key under `/etc/wizloft/runner-tls/` (key mode 600).
8. Run `probe-egress.sh` (below), reboot the VM, and run it again.
9. Record the VM, addresses, rules and results in `infra:docs/build-log.md`.

Probe, from a throwaway container on `fn-sandbox`:

| Target | Expected |
|--------|----------|
| `https://example.com`, DNS lookup of a public name | succeeds |
| 10.10.10.1, 10.10.10.20:8000, 10.10.10.30:80, 10.10.10.40:5432, 10.10.10.110:8006, 10.10.10.201 | no connection |
| 10.10.10.50:22, 10.10.10.50:8443, 10.210.1.1 | no connection |
| a second container on `fn-sandbox` | no connection |

From another LAN machine: 10.10.10.50:8443 refuses; from apps-prod it connects.

## Todo

- [ ] Owner approval and Proxmox key received; pre-change state recorded
- [ ] `openclaw` backed up and removed
- [ ] `runner` VM created, reserved, baselined
- [ ] Docker and `fn-sandbox` configured
- [ ] Egress and agent-port rules applied and persistent
- [ ] Certificate issued, DNS record added
- [ ] Probe passes before and after a reboot
- [ ] Build log updated

## Success Criteria

- `qm list` shows 150 `runner` running and no VMID 100; allocated guest RAM is 26 GiB.
- Every row of the probe table holds before and after a reboot.
- `openssl verify -CAfile infra:scripts/db/wizloft-db-ca.crt` accepts the runner certificate.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Removing the wrong VM | Read `qm config 100` and its name first; back up; owner confirms at the prompt |
| A rule locks out SSH | Rules match only source 10.210.1.0/24 and port 8443; keep a console session open while applying |
| Rules lost after reboot | systemd unit ordered after `docker.service`; the probe is repeated after a reboot |
| Thin pool fuller than assumed | Read `lvs` data and metadata percentages in step 1; stop if data use exceeds 70% |

## Security Considerations

- The Proxmox key is used only for the steps above and is not stored in either repository.
- Rollback: `qm destroy 150 --purge` removes the new VM; `openclaw` can be restored from the vzdump archive.

## Next Steps

Phase 8 deploys the agent to this VM.
