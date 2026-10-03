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
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_RESULTS_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SubmitResultDto)
  results!: SubmitResultDto[];
}
