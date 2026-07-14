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

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_placeholder
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

# Public runtime config is inlined at build time by Next.js, so it must be
# provided here (not just as App Service settings). Defaults point at the POC
# cloud API/web so a plain `docker build` produces a working image.
ARG NEXT_PUBLIC_API_URL=https://spaceorder-api-app-poc-h7hef6a2gtd5euhq.israelcentral-01.azurewebsites.net/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL=https://spaceorder-web-app-poc2.azurewebsites.net
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_AZURE_MAPS_KEY=
ENV NEXT_PUBLIC_AZURE_MAPS_KEY=$NEXT_PUBLIC_AZURE_MAPS_KEY

RUN npm run build --workspace @workforce/shared
RUN npm run build --workspace @workforce/web

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start", "--workspace", "@workforce/web", "--", "-p", "8080"]
