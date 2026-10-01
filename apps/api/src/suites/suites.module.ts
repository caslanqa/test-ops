import { Module } from "@nestjs/common";
import { SuitesService } from "./suites.service";
import { SuitesController } from "./suites.controller";

@Module({
  controllers: [SuitesController],
  providers: [SuitesService],
  exports: [SuitesService],
})
export class SuitesModule {}
