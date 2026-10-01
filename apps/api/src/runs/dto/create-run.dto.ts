import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { RunSource } from "@prisma/client";

export class CreateRunDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsString()
  milestoneId?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  // CI build/commit/sürüm bilgisi (design-doc.md FR-033)
  @IsOptional()
  @IsString()
  build?: string;

  @IsOptional()
  @IsString()
  configuration?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(RunSource)
  source?: RunSource;

  // planId verilmezse ad hoc case seçimi (FR-032)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  testCaseIds?: string[];
}
