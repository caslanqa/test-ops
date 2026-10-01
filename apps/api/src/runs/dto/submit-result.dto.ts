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

  @IsEnum(ResultStatus)
  status!: ResultStatus;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
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

  // Otomasyon sonuçlarında idempotency için dış test kimliği (FR-075)
  @IsOptional()
  @IsString()
  externalTestId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StepResultDto)
  stepResults?: StepResultDto[];
}
