import { Module } from "@nestjs/common";
import { SystemFieldsController } from "./system-fields.controller";

@Module({ controllers: [SystemFieldsController] })
export class SystemFieldsModule {}
