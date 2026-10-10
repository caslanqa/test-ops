import "reflect-metadata";
import { existsSync } from "fs";
import { join } from "path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { ValidationPipe, Logger } from "@nestjs/common";
import { SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import type { Request, Response, NextFunction } from "express";
import { AppModule } from "./app.module";
import { buildOpenApiDocument } from "./openapi";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger("Bootstrap");
  const config = app.get(ConfigService);

  // The rate limit identifies the client by req.ip; behind a reverse proxy the real
  // client address is read from X-Forwarded-For only if the proxy is declared trusted.
  app.set("trust proxy", config.get("rateLimit.trustProxy"));

  app.use(helmet());
  // Browsers only expose these response headers to cross-origin scripts when listed here.
  app.enableCors({
    exposedHeaders: [
      "X-Total-Count",
      "Retry-After",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
  });
  // FR-074: bulk uploads need more than Express's 100 KB JSON default. Registered after helmet and
  // CORS, so a 413 still carries their headers, and before the app initializes, so Nest skips its
  // own default JSON parser instead of adding a second one.
  app.useBodyParser("json", { limit: config.get<number>("http.maxJsonBodyBytes") });
  app.setGlobalPrefix("api/v1", { exclude: ["health", "ready"] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // FR-070: documented REST API under /api/v1 + OpenAPI schema (see openapi.ts)
  SwaggerModule.setup("api/docs", app, buildOpenApiDocument(app), {
    customSiteTitle: "TestOps API reference",
  });

  // SPA fallback: routes GET requests outside /api, /health, /ready that match no
  // static file to index.html (React Router client-side routing).
  const webIndex = join(__dirname, "..", "web", "index.html");
  if (existsSync(webIndex)) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const isAppRoute =
        req.method === "GET" &&
        !req.path.startsWith("/api/") &&
        req.path !== "/health" &&
        req.path !== "/ready" &&
        !req.path.includes(".");
      if (isAppRoute) {
        res.sendFile(webIndex);
        return;
      }
      next();
    });
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  logger.log(`TestOps API listening on port ${port}`);
}

bootstrap();
