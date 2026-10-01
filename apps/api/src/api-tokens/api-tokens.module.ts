import { Module } from "@nestjs/common";
import { ApiTokensService } from "./api-tokens.service";
import { ApiTokensController } from "./api-tokens.controller";

@Module({
  controllers: [ApiTokensController],
  providers: [ApiTokensService],
  exports: [ApiTokensService],
})
export class ApiTokensModule {}
