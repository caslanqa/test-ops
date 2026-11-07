import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsString } from "class-validator";

export const BULK_CASES_MAX_ITEMS = 500;

export class BulkCopyTestCasesDto {
  @ApiProperty({ description: "IDs of cases to copy", minItems: 1, maxItems: BULK_CASES_MAX_ITEMS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_CASES_MAX_ITEMS)
  @IsString({ each: true })
  caseIds!: string[];

  @ApiPropertyOptional({ description: "Target suite ID. Null means copy to top level." })
  @IsOptional()
  @IsString()
  targetSuiteId?: string;
}
