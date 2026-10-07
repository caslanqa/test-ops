import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayNotEmpty, IsArray, ValidateNested } from "class-validator";
import { CreateTestCaseDto } from "./create-test-case.dto";

/** Same limit as bulk result submission (FR-074). */
export const BULK_CASES_MAX_ITEMS = 500;

export class BulkCreateTestCasesDto {
  // The CLI plugin doesn't translate the array size rules, so the limits are stated here.
  @ApiProperty({ type: [CreateTestCaseDto], minItems: 1, maxItems: BULK_CASES_MAX_ITEMS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_CASES_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CreateTestCaseDto)
  cases!: CreateTestCaseDto[];
}
