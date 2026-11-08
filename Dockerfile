# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Runtime C++ standard library required by better-sqlite3's prebuilt binary on Alpine
RUN apk add --no-cache libstdc++

# better-sqlite3 v13+ already bundles prebuilt binaries in prebuilds/ (linuxmusl-x64.node, linux-x64.node, etc.)
# Passing --ignore-scripts skips npm's automatic node-gyp rebuild (zero Python/C++ compilation needed!)
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run verify && npm run build && npm prune --omit=dev --ignore-scripts

# Stage 2: Production runner stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV DATABASE_PATH=/app/data/keranjang.db

# Runtime C++ standard library required by better-sqlite3's prebuilt binary on Alpine
RUN apk add --no-cache libstdc++

# Copy already-pruned production node_modules and dist from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create persistent storage directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]
