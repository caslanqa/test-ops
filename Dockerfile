# TestOps - tek imaj: NestJS API + React SPA aynı container/port'tan servis edilir
# (design-doc.md bölüm 7: "Uygulama tek versiyonlu OCI/Docker image olarak yayımlanır").
# PostgreSQL bilerek bu imajın dışında, ayrı bir servis/container olarak çalışır.
FROM node:20-bookworm-slim AS base
# Prisma engine binary'leri libssl'e ihtiyaç duyar (ARM64/Debian slim imajlarda varsayılan yok)
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
# SPA dosyaları dist'in yanına (ServeStaticModule rootPath = dist/../web) kopyalanır
COPY --from=build /app/apps/web/dist /app/apps/api/web
WORKDIR /app/apps/api

# Container içeride bu portu dinler (PORT env ile değiştirilebilir); dışa açılan
# host portu `docker run -p <İSTEDİĞİNİZ_PORT>:3000` ile serbestçe seçilir.
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=10 CMD curl -f http://localhost:${PORT}/health || exit 1
# DB hazır olana kadar migrate deploy bekler, sonra tek process API+UI'ı başlatır
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
