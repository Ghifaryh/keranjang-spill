# Stage 1: Build stage (node:22-slim uses glibc so better-sqlite3 downloads a prebuilt binary in ~1s instead of compiling C++ from source)
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run verify && npm run build && npm prune --omit=dev

# Stage 2: Production runner stage
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV DATABASE_PATH=/app/data/keranjang.db

# Copy already-pruned production node_modules and compiled dist from builder (no second npm ci!)
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create persistent storage directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]
