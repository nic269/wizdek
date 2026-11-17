# Runtime for Node.js and TypeScript functions. Debian-based so prebuilt
# native modules install without a compiler.
FROM node:24-bookworm-slim

# Nothing outside /tmp is writable at run time.
ENV HOME=/tmp \
    NO_UPDATE_NOTIFIER=1 \
    npm_config_cache=/tmp/.npm

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin fn

COPY wrapper.mjs /opt/fn/wrapper.mjs

USER 10001:10001
WORKDIR /fn
