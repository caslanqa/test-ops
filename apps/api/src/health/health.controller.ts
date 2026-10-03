import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaHealthIndicator } from "./prisma-health.indicator";
import { Public } from "../common/decorators/public.decorator";

// Orchestrator/monitoring probes are frequent and come from a single IP; the rate
// limit must not make them report "unhealthy" and restart the container.
@SkipThrottle()
@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
  ) {}

  // Liveness: is the process up, no DB check
  @Public()
  @Get("health")
  liveness() {
    return { status: "ok" };
  }

  // Readiness: reject traffic until the DB is ready (design-doc.md section 7)
  @Public()
  @Get("ready")
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.prismaHealth.isHealthy("database")]);
  }
}
