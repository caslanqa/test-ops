import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { ResultSource, ResultStatus } from "@prisma/client";
import { StepResultDto } from "./step-result.dto";

export class SubmitResultDto {
  @IsString()
  testCaseId!: string;

  @ApiProperty({ enum: ResultStatus, enumName: "ResultStatus" })
  @IsEnum(ResultStatus)
  status!: ResultStatus;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @ApiPropertyOptional({ enum: ResultSource, enumName: "ResultSource" })
  @IsEnum(ResultSource)
  source?: ResultSource;

  @IsOptional()
  @IsString()
  automationSourceLabel?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsOptional()
  @IsInt()
  durationMs?: number;

  // External test ID for idempotency of automation results (FR-075)
  @IsOptional()
  @IsString()
  externalTestId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StepResultDto)
  stepResults?: StepResultDto[];
}
