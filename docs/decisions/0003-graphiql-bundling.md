# Decision 0003: Bundle GraphiQL with the default Next.js toolchain

- Status: accepted
- Date: 2026-10-14

## Context

The console embeds `graphiql` 5.4.0 with `@graphiql/plugin-explorer` 5.1.5. Two things were unproven before work started:

- GraphiQL edits with Monaco, which runs language services in web workers. The package ships worker setup for webpack, Vite and esm.sh; its official Next.js example uses the webpack setup on Next 15. This repository runs Next 16, where Turbopack is the default bundler for both `next dev` and `next build`.
- The Explorer plugin wraps `graphiql-explorer` 0.9.0, last published in 2022, whose declared peers stop at React 16 and `graphql` 15. This app runs React 19 and `graphql` 16.

Three options were lined up in order: keep the default toolchain; run the app on webpack; or ship the console as a separate Vite bundle in an iframe.

## What was tested

A throwaway page rendered `<GraphiQL>` with `explorerPlugin()` and `import "graphiql/setup-workers/webpack"` against a local schema. A scripted browser session ran against `next dev` and against `next build` followed by `next start`, and checked the same things in both:

| Check | `next dev` | Production |
|-------|-----------|------------|
| Monaco workers start | 3 workers | 3 workers |
| Autocomplete offers schema fields after typing `{ sh` | yes | yes |
| Explorer renders the schema's root fields | yes | yes |
| Ticking Explorer fields rewrites the query | yes | yes |
| Uncaught page errors | none | none |

The one message seen was a React warning from the Explorer in development about an input switching from controlled to uncontrolled. It does not affect behaviour and does not appear in production.

`pnpm install` reports unmet peers for `graphiql-explorer` (React and `graphql` ranges). The test above shows they are declaration gaps, not runtime failures.

## Decision

Use option 1: the default Next 16 toolchain with `graphiql/setup-workers/webpack`. No bundler override and no iframe.

Two implementation notes follow from the spike:

- GraphiQL is loaded with `next/dynamic` and `ssr: false`, because Monaco needs the browser.
- Passing a `plugins` prop replaces GraphiQL's default plugin list, so the history plugin is listed explicitly next to the Explorer.

## Revisit when

- A Next.js or GraphiQL upgrade breaks worker loading or autocomplete. The browser test `tests/e2e/graphql-console.spec.ts` covers the Explorer, running a query and the editor; autocomplete was checked by hand in the spike and is worth rechecking after such an upgrade. Options 2 and 3 remain the fallbacks.
- `graphiql-explorer` stops rendering under a future React. There is no maintained replacement, so that would mean writing a field tree for the console.
