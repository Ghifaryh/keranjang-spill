# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install native dependencies required by better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production runner stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV DATABASE_PATH=/app/data/keranjang.db

# better-sqlite3 runtime dependencies
RUN apk add --no-cache libstdc++

# Install production dependencies only
COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm ci --omit=dev && \
    apk del .build-deps

# Copy compiled Astro output from builder
COPY --from=builder /app/dist ./dist

# Create persistent storage directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]
