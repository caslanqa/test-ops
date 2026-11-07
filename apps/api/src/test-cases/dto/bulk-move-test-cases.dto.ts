import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

/** Same limit as bulk create (FR-074). */
export const BULK_CASES_MAX_ITEMS = 500;

export class BulkMoveTestCasesDto {
  @ApiProperty({ description: "IDs of cases to move", minItems: 1, maxItems: BULK_CASES_MAX_ITEMS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_CASES_MAX_ITEMS)
  @IsString({ each: true })
  caseIds!: string[];

  @ApiPropertyOptional({ description: "Target suite ID. Null means move to top level." })
  @IsOptional()
  @IsString()
  targetSuiteId?: string;
}
