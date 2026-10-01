import { Module } from "@nestjs/common";
import { DefectsService } from "./defects.service";
import { DefectsController } from "./defects.controller";

@Module({
  controllers: [DefectsController],
  providers: [DefectsService],
  exports: [DefectsService],
})
export class DefectsModule {}
