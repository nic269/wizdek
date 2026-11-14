---
phase: 3
title: "Logs và chẩn đoán chỉ đọc"
status: in-progress
priority: P2
effort: "2d"
dependencies: [2]
---

# Phase 3: Logs và chẩn đoán chỉ đọc

## Goal
Overview, logs, cron state và settings view đọc DB đúng môi trường.

## Files
App server/services/{overview,workflow-logs,cron-status,settings-read}.ts, server/db/queries/, app/e/[profileId]/{overview,logs,cronjobs,settings}/, GET routes, redaction/tests.

## Tasks & steps
- [x] P3.1 Port workflow filters module/feature/status/shop/actor/date/search, capped stable pagination and separate log-detail pages. Explicit account scope or explicitly global diagnostic permission.
- [x] P3.2 Overview: separate DB/API health, schema capability, recent failed jobs and refresh time. No auto-repair. DB grants/server guard enforce reads.
- [x] P3.3 Cron stored state + API catalog for definitions/defaults absent from DB. Before bridge show stored keys/capability note, no fabricated defaults or copied scheduler definitions.
- [x] P3.4 Typed settings reads select needed columns; do not fetch encrypted credentials unnecessarily.
- [x] P3.5 Redact secrets embedded in logs, including authorization/cookie/connection strings. Loading/empty/offline/incompatible/denied states, bounded queries, no persistent browser cache.
- [ ] P3.6 Record parity and query plans. Index requests require reviewed OMS migration and backup; never automatic DDL.

## Verification
App test:integration/test:e2e. Same-ID fixtures prove every detail/list is profile/account/revision scoped. SQL instrumentation proves GET/test/probe performs zero writes. 100k-log fixture tests bounded pages; inspect EXPLAIN/response size. Fake secrets absent from browser/DTO/logs.

## Risks / response
Source cron GET initializes configs; management read path must not copy that side effect. Schema drift disables only affected feature. Original import downloads/object storage handled in phase 5 preserving CSV fallback.

## Implementation checkpoint — 2026-11-14

Filters/UI/detail/summary/redaction, DB/schema status và API cron catalog đã implement. 100k-log fixture và bounded queries pass. P3.6 còn live parity và query-plan review với data/index thực tế.

Checked tasks reflect implemented local scope; remaining live/expanded verification is not implied. See [implementation evidence](./implementation-report.md).
