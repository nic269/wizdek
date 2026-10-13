FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS pruner
ARG APP_SCOPE=@repo/app
RUN npm install --global turbo@^2.10.3
COPY . .
RUN turbo prune "${APP_SCOPE}" --docker

FROM base AS installer
ARG APP_SCOPE=@repo/app
ARG API_INTERNAL_URL=http://api:3002
ARG APP_INTERNAL_URL=http://app:3000
ARG NEXT_PUBLIC_API_URL=http://localhost:3002
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_DOCS_URL
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
ENV APP_INTERNAL_URL=${APP_INTERNAL_URL}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_DOCS_URL=${NEXT_PUBLIC_DOCS_URL}
ENV NEXT_PUBLIC_WEB_URL=${NEXT_PUBLIC_WEB_URL}
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=true
COPY --from=pruner /app/out/json/ .
RUN mkdir -p scripts
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter="${APP_SCOPE}"
RUN if [ -e packages/database/node_modules/@prisma/client ]; then \
      client_dir="$(dirname "$(node -p "require.resolve('@prisma/client', { paths: ['packages/database'] })")")"; \
      modules_dir="$(dirname "$(dirname "${client_dir}")")"; \
      mkdir -p /tmp/prisma-runtime; \
      cp -RL "${client_dir}" /tmp/prisma-runtime/client; \
      cp -RL "${modules_dir}/.prisma/client" /tmp/prisma-runtime/generated; \
    fi

FROM node:24-alpine AS next-runner-base
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app

FROM next-runner-base AS app-runner
ENV PORT=3000
EXPOSE 3000
COPY --from=installer --chown=app:app /app/apps/app/.next/standalone ./
COPY --from=installer --chown=app:app /app/apps/app/.next/static ./apps/app/.next/static
COPY --from=installer --chown=app:app /app/apps/app/public ./apps/app/public
USER app
CMD ["node", "apps/app/server.js"]

FROM next-runner-base AS web-runner
ENV PORT=3001
EXPOSE 3001
COPY --from=installer --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=installer --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=app:app /app/apps/web/public ./apps/web/public
USER app
CMD ["node", "apps/web/server.js"]

FROM base AS api-runner
ENV NODE_ENV=production
ENV PORT=3002
RUN addgroup -S app && adduser -S app -G app
COPY --from=pruner /app/out/json/ .
RUN mkdir -p scripts
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
RUN pnpm install --prod --frozen-lockfile \
      --filter @repo/api-app \
      --filter @repo/api \
      --filter @repo/access-control \
      --filter @repo/auth \
      --filter @repo/database \
      --filter @repo/jobs \
      --filter @repo/logger \
      --filter @repo/mail \
      --filter @repo/storage
COPY --from=installer --chown=app:app /app/apps/api/dist ./apps/api/dist
RUN rm -rf packages/database/node_modules/@prisma/client
COPY --from=installer --chown=app:app /tmp/prisma-runtime/client ./packages/database/node_modules/@prisma/client
COPY --from=installer --chown=app:app /tmp/prisma-runtime/generated ./packages/database/node_modules/.prisma/client
COPY --from=installer --chown=app:app /tmp/prisma-runtime/generated ./apps/api/node_modules/.prisma/client
RUN client_dir="$(dirname "$(node -p "require.resolve('@prisma/client/default.js', { paths: ['apps/api'] })")")"; \
      pnpm_prisma_dir="$(dirname "$(dirname "${client_dir}")")/.prisma/client"; \
      mkdir -p "$(dirname "${pnpm_prisma_dir}")"; \
      cp -RL ./apps/api/node_modules/.prisma/client "${pnpm_prisma_dir}"
USER app
EXPOSE 3002
CMD ["node", "/app/apps/api/dist/index.cjs"]
