import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { ResultSource, ResultStatus } from "@prisma/client";
import { MAX_INT32 } from "../../common/limits";
import { StepResultDto } from "./step-result.dto";
import { RESULT_COMMENT_MAX_LENGTH, STEP_RESULTS_MAX_ITEMS } from "./result-limits";

export class SubmitResultDto {
  @IsString()
  testCaseId!: string;

  @ApiProperty({ enum: ResultStatus, enumName: "ResultStatus" })
  @IsEnum(ResultStatus)
  status!: ResultStatus;

  @IsOptional()
  @IsString()
  @MaxLength(RESULT_COMMENT_MAX_LENGTH)
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
  @Min(0)
  @Max(MAX_INT32)
  durationMs?: number;

  // External test ID for idempotency of automation results (FR-075)
  @IsOptional()
  @IsString()
  externalTestId?: string;

  // The CLI plugin doesn't translate the array size rules, so the limit is stated here.
  @ApiPropertyOptional({ type: [StepResultDto], maxItems: STEP_RESULTS_MAX_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(STEP_RESULTS_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => StepResultDto)
  stepResults?: StepResultDto[];
}
