---
title: Product shell and shadcn controls
date: 2026-10-14
summary: "Ported the Meldmark app shell, made the app light-only, and replaced native form controls with shadcn components"
---

# Product shell and shadcn controls

## What changed

- `AppShell` in `@repo/design-system` is now the Meldmark shell: collapsible sidebar, ⌘K destination search, a mobile sheet, and a footer slot. The current nav item is the longest matching href, so `/settings/members` no longer also highlights Settings.
- `AppShellLayout` puts every signed-in page in one white panel on a grey canvas. The organization switcher and a new account menu (settings, sign out) sit in the sidebar footer. The old `SignOutButton` is gone.
- The palette tokens are scoped to `body.product-app`, so portalled dialogs and menus share them. The theme provider is light-only.
- Native `select`, `input[type=checkbox|file]`, `label`, `button` and `datalist` in the app were replaced with shadcn `Select` (through `OptionSelect`), `Checkbox`, `Label`, `Field`, `Button`, `Input` and `Combobox`.

## Decisions

- Base UI `Select` treats an empty string ambiguously, so "All" filter options use sentinel values ("ALL", "all", "custom") that are mapped back at the call site.
- The webhook topic uses `Combobox` with a controlled `inputValue`, so topics that aren't in the suggestion list can still be typed.

## Verification

- Ran biome and the type checks; the unit tests pass.
- Ran the e2e suite against an isolated stack (Postgres on 5441, API on 3012, app on 3010): 16 of 17 passed. The one failure, password recovery, sends a hardcoded `Origin: http://localhost:3000`, which the 3010 stack rejects. That test doesn't touch the UI.
- The dev servers on 3000/3002 belonged to Meldmark, so they were left untouched.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
