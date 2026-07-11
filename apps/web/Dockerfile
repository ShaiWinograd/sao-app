FROM node:22-bookworm-slim

WORKDIR /app

# Install workspace dependencies first for better layer caching.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

# Copy source after dependencies.
COPY tsconfig.base.json turbo.json ./
COPY apps/web apps/web
COPY packages/shared packages/shared

RUN npm run build --workspace @workforce/shared
RUN npm run build --workspace @workforce/web

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start", "--workspace", "@workforce/web", "--", "-p", "8080"]
