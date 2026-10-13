# Shopify Toolkit

## Foundation
Profile: `saas`


- pnpm and Turborepo monorepo
- TypeScript strict and Ultracite-on-Biome
- Next.js App Router, Hono, Better Auth, Prisma, and PostgreSQL
- Shared shadcn Base UI design system
- Vitest and Playwright

## App Surfaces

- `apps/app`
- `apps/api`

## Boundaries

- Apps do not import from other apps.
- Packages do not import from apps.
- Optional integrations disable cleanly when credentials are absent.
- Product-specific domain behavior stays outside reusable core packages.
