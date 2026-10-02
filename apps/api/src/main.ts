import "reflect-metadata";
import { existsSync } from "fs";
import { join } from "path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { ValidationPipe, Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import type { Request, Response, NextFunction } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger("Bootstrap");

  // Rate limit istemciyi req.ip ile tanır; ters proxy arkasında gerçek istemci
  // adresi X-Forwarded-For'dan ancak proxy güvenilir ilan edilirse okunur.
  app.set("trust proxy", app.get(ConfigService).get("rateLimit.trustProxy"));

  app.use(helmet());
  app.enableCors();
  app.setGlobalPrefix("api/v1", { exclude: ["health", "ready"] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // FR-070: /api/v1 altında belgelenmiş REST API + OpenAPI şeması
  const swaggerConfig = new DocumentBuilder()
    .setTitle("TestOps API")
    .setDescription("TestOps public REST API (v1)")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  // SPA fallback: statik dosya eşleşmeyen /api, /health, /ready dışındaki
  // GET isteklerini index.html'e yönlendirir (React Router client-side routing).
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
