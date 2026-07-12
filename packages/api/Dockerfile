FROM node:22-bookworm-slim

# openssl + ca-certificates are required for Prisma engines to negotiate TLS
# (Azure Postgres requires SSL) and to detect the correct engine binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install workspace dependencies first for better layer caching.
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci

# Copy source after dependencies.
COPY tsconfig.base.json turbo.json ./
COPY packages/api packages/api
COPY packages/shared packages/shared
COPY packages/database packages/database

RUN npm run build --workspace @workforce/shared
RUN npm run db:generate --workspace @workforce/database
RUN npm run build --workspace @workforce/api

ENV NODE_ENV=production
ENV API_PORT=3001
EXPOSE 3001

CMD ["npm", "run", "start", "--workspace", "@workforce/api"]
