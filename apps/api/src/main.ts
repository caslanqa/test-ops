import "reflect-metadata";
import { existsSync } from "fs";
import type { Server } from "http";
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
  shutDownGracefully(app, logger);
}

/**
 * On SIGTERM (docker stop, compose down) or SIGINT the server stops taking new connections and
 * lets running requests, such as uploads and CI submissions, finish; only then are the modules
 * shut down (database connections), and the process exits. Nest's own enableShutdownHooks()
 * closes the database first and the server last, and re-raises the signal to exit, which a
 * process running as PID 1 ignores. A second signal stops the process at once.
 */
function shutDownGracefully(app: NestExpressApplication, logger: Logger) {
  const signals = ["SIGTERM", "SIGINT"] as const;
  const onSignal = async (signal: NodeJS.Signals) => {
    for (const s of signals) process.removeListener(s, onSignal);
    logger.log(`${signal} received; finishing running requests before shutting down`);
    try {
      const server: Server = app.getHttpServer();
      // A keep-alive connection that goes idle once its request is answered is closed right away,
      // not after the keep-alive timeout.
      const sweep = setInterval(() => server.closeIdleConnections(), 250);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      clearInterval(sweep);
      await app.close();
      process.exit(0);
    } catch (err) {
      logger.error(`Shutdown failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  };
  for (const s of signals) process.on(s, onSignal);
}

bootstrap();
