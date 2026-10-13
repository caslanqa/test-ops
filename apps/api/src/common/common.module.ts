import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthGuard } from "./guards/auth.guard";
import { AccessControlService } from "./access-control.service";
import { AppThrottlerGuard, AuthFailureLimiter, throttlerOptions } from "./rate-limit";
import { PrismaExceptionFilter } from "./prisma-exception.filter";

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("jwt.secret"),
        signOptions: { expiresIn: config.get<string>("jwt.expiresIn") },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: throttlerOptions,
    }),
  ],
  providers: [
    AccessControlService,
    AuthFailureLimiter,
    // Order matters: the rate limit identity is read from request.user, set by AuthGuard.
    // Requests AuthGuard rejects never reach AppThrottlerGuard; AuthFailureLimiter counts them.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    // Database errors caused by the request answer 4xx instead of 500.
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
  exports: [AccessControlService, JwtModule],
})
export class CommonModule {}
