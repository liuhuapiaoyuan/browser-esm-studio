# syntax=docker/dockerfile:1

# ── Build ──────────────────────────────────────────────────────────
FROM oven/bun:1.3.14-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Browser defaults stay same-origin so nginx proxies work in production.
# Override at build time if needed: --build-arg VITE_AI_BASE_URL=...
ARG VITE_AI_BASE_URL=/openai-proxy/v1
ARG VITE_AI_MODEL=gpt-4o
ARG VITE_LITE_IMAGE_BASE_URL=/lite-image-proxy/v1
ENV VITE_AI_BASE_URL=$VITE_AI_BASE_URL \
    VITE_AI_MODEL=$VITE_AI_MODEL \
    VITE_LITE_IMAGE_BASE_URL=$VITE_LITE_IMAGE_BASE_URL

RUN bun run build

# ── Runtime (nginx + reverse proxies) ──────────────────────────────
FROM nginx:1.27-alpine

# Upstream targets / identity headers — override with -e / compose.
ENV AI_PROXY_TARGET=https://api.openai.com \
    DYNAMIC_DB_BASE_URL=https://dynamic-db.b.nps.qzsyzn.com \
    DDB_USER_ID=dev-user \
    DDB_ROLES=admin \
    LITE_IMAGE_PROXY_TARGET=https://api.siliconflow.cn
# LITE_IMAGE_API_KEY — pass at runtime only: -e LITE_IMAGE_API_KEY=...

COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/15-lite-image-auth.sh /docker-entrypoint.d/15-lite-image-auth.sh
RUN chmod +x /docker-entrypoint.d/15-lite-image-auth.sh

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
