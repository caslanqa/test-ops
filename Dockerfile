# TestOps - single image: the NestJS API + React SPA are served from the same container/port
# (design-doc.md section 7: "The application is published as a single versioned OCI/Docker image").
# PostgreSQL deliberately stays outside this image and runs as a separate service/container.
FROM node:20-bookworm-slim AS base
# Prisma engine binaries need libssl (not present by default in ARM64/Debian slim images)
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @testops/api run prisma:generate \
    && pnpm --filter @testops/api run build
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @testops/web run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/api/prisma /app/apps/api/prisma
COPY --from=build /app/apps/api/package.json /app/apps/api/package.json
# SPA files are copied next to dist (ServeStaticModule rootPath = dist/../web)
COPY --from=build /app/apps/web/dist /app/apps/api/web
COPY --chmod=0755 apps/api/docker-entrypoint.sh /app/apps/api/docker-entrypoint.sh
WORKDIR /app/apps/api

# The container listens on this port internally (configurable via the PORT env var); the
# exposed host port can be chosen freely with `docker run -p <YOUR_PORT>:3000`.
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=10 CMD curl -f http://localhost:${PORT}/health || exit 1
# Checks DATABASE_URL, retries migrate deploy until the DB is ready, then starts
# the single API+UI process (see apps/api/docker-entrypoint.sh)
CMD ["./docker-entrypoint.sh"]
