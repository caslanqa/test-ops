import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from "class-validator";

export const BULK_CASES_MAX_ITEMS = 500;

export class BulkArchiveTestCasesDto {
  @ApiProperty({ description: "IDs of cases to archive", minItems: 1, maxItems: BULK_CASES_MAX_ITEMS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_CASES_MAX_ITEMS)
  @IsString({ each: true })
  caseIds!: string[];
}
