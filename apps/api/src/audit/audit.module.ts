import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";

/** Global, like PrismaModule: any module can record an audit entry. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
