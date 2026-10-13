import { ApiPropertyOptional } from "@nestjs/swagger";
import { ResultStatus } from "@prisma/client";
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { MAX_INT32 } from "../../common/limits";
import { RESULT_COMMENT_MAX_LENGTH } from "./result-limits";

/** Fields of a result that can be corrected after it was submitted; omitted fields are kept. */
export class UpdateResultDto {
  @ApiPropertyOptional({ enum: ResultStatus, enumName: "ResultStatus" })
  @IsOptional()
  @IsEnum(ResultStatus)
  status?: ResultStatus;

  @IsOptional()
  @IsString()
  @MaxLength(RESULT_COMMENT_MAX_LENGTH)
  comment?: string;

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
}
