import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  ValidateNested,
} from "class-validator";
import { SubmitResultDto } from "./submit-result.dto";

// FR-074: bulk request size must be limited
export const BULK_RESULTS_MAX_ITEMS = 500;

export class BulkSubmitResultsDto {
  // The CLI plugin doesn't translate the array size rules, so the limits are stated here.
  @ApiProperty({ type: [SubmitResultDto], minItems: 1, maxItems: BULK_RESULTS_MAX_ITEMS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_RESULTS_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SubmitResultDto)
  results!: SubmitResultDto[];
}
