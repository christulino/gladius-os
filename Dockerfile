# syntax=docker/dockerfile:1

# ── Stage 1: build the admin UI ────────────────────────────────────────────────
FROM node:24-alpine AS ui-build
WORKDIR /app/admin-ui
COPY admin-ui/package.json admin-ui/package-lock.json ./
RUN npm ci
COPY admin-ui/ ./
RUN npm run build

# ── Stage 2: production runtime ────────────────────────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# API production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application source. .dockerignore keeps node_modules, .git, .env, docs, tests,
# and admin-ui build artifacts (node_modules/dist) out; the admin-ui source that
# COPY . . brings in is harmless and gets its built output overlaid from stage 1
# below.
COPY . .

# Built admin UI from stage 1 (overlays any stale dist).
COPY --from=ui-build /app/admin-ui/dist ./admin-ui/dist

# Baked entrypoint.
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
