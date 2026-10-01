import { Module } from "@nestjs/common";
import { TestCasesService } from "./test-cases.service";
import { TestCasesController } from "./test-cases.controller";

@Module({
  controllers: [TestCasesController],
  providers: [TestCasesService],
  exports: [TestCasesService],
})
export class TestCasesModule {}
