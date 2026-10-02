import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaHealthIndicator } from "./prisma-health.indicator";
import { Public } from "../common/decorators/public.decorator";

// Orkestratör/izleme yoklamaları sık ve tek IP'den gelir; rate limit onları
// "unhealthy" gösterip container'ı yeniden başlatmamalı.
@SkipThrottle()
@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
  ) {}

  // Liveness: process ayağa kalkmış mı, DB kontrolü yok
  @Public()
  @Get("health")
  liveness() {
    return { status: "ok" };
  }

  // Readiness: DB hazır olana kadar trafiği reddet (design-doc.md bölüm 7)
  @Public()
  @Get("ready")
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.prismaHealth.isHealthy("database")]);
  }
}
