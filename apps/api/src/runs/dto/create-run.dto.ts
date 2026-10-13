import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { RunSource } from "@prisma/client";

export class CreateRunDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  planId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  milestoneId?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  // CI build/commit/version info (design-doc.md FR-033)
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
  @ApiPropertyOptional({ enum: RunSource, enumName: "RunSource" })
  @IsEnum(RunSource)
  source?: RunSource;

  // ad hoc test case selection when no planId is given (FR-032)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  testCaseIds?: string[];
}
