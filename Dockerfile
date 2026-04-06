# ── Stage 1: Compile TypeScript backend ───────────────────────────────────────
FROM node:20-alpine AS backend-builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 3: Production runtime ───────────────────────────────────────────────
# node:20-slim (Debian) is required for Playwright's Chromium browser binaries.
# Alpine does not support Playwright's pre-built binaries.
FROM node:20-slim AS production
WORKDIR /app
ENV NODE_ENV=production

# Install system dependencies required by Playwright / Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install production Node dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright Chromium browser and its OS-level dependencies.
# This matches the exact Chromium version bundled with the installed playwright package.
RUN npx playwright install --with-deps chromium

# Copy compiled backend output
COPY --from=backend-builder /app/dist ./dist

# Copy SQL migrations alongside the compiled code so dist/db/migrate.js can find them
COPY src/db/migrations ./dist/db/migrations

# Copy built React frontend — served as static files by Fastify in production
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy and prepare the entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

# Health check — relies on GET /health returning 200
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run migrations then start the server
ENTRYPOINT ["./docker-entrypoint.sh"]
