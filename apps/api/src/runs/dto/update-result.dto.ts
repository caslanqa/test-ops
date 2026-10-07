import { ApiPropertyOptional } from "@nestjs/swagger";
import { ResultStatus } from "@prisma/client";
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

/** Fields of a result that can be corrected after it was submitted; omitted fields are kept. */
export class UpdateResultDto {
  @ApiPropertyOptional({ enum: ResultStatus, enumName: "ResultStatus" })
  @IsOptional()
  @IsEnum(ResultStatus)
  status?: ResultStatus;

  @IsOptional()
  @IsString()
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
  durationMs?: number;
}
