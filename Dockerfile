# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV DATA_ROOT=/data/marcia-recipe
WORKDIR /app

RUN groupadd --system --gid 1001 app \
  && useradd --system --uid 1001 --gid app app \
  && mkdir -p /data/marcia-recipe \
  && chown -R app:app /data

COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static

USER app
EXPOSE 3000
CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
# tools stage — exposes tsx + scripts + src + the committed demo seed so the
# demo host can restore its DATA_ROOT from an immutable repo-managed seed
# without expanding the slim production image.  Reach this stage only via the
# `seed-restore` profile service in docker-compose.yml.
# ---------------------------------------------------------------------------
FROM builder AS tools
WORKDIR /app
# The builder stage already has the full source, node_modules (incl. tsx as a
# devDependency) and built .next output — everything `npm run
# cli:restore-demo-seed` imports is here.  No CMD is baked in: the workflow
# supplies the entrypoint via `docker compose run --rm seed-restore npm run …`.