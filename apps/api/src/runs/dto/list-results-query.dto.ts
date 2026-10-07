import { ApiPropertyOptional } from "@nestjs/swagger";
import { ResultSource, ResultStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListResultsQueryDto extends PageQueryDto {
  /** Only results of this run. */
  @IsOptional()
  @IsString()
  runId?: string;

  /** Only results of this test case, across runs. */
  @IsOptional()
  @IsString()
  testCaseId?: string;

  @ApiPropertyOptional({ enum: ResultStatus, enumName: "ResultStatus" })
  @IsOptional()
  @IsEnum(ResultStatus)
  status?: ResultStatus;

  @ApiPropertyOptional({ enum: ResultSource, enumName: "ResultSource" })
  @IsOptional()
  @IsEnum(ResultSource)
  source?: ResultSource;

  /** Only the latest attempt of each test case in a run (hides earlier retries). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  latestOnly?: boolean;

  /** Only results created at or after this time (ISO 8601). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Only results created at or before this time (ISO 8601). */
  @IsOptional()
  @IsDateString()
  to?: string;
}
