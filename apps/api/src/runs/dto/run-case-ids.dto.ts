import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsString, ValidateIf } from "class-validator";

/** Same limit as bulk result submission (FR-074). */
export const BULK_RUN_CASES_MAX_ITEMS = 500;

/** Several cases of one run, for an action on all of them at once. */
export class RunCaseIdsDto {
  // The CLI plugin doesn't translate the array size rules, so the limits are stated here.
  @ApiProperty({ type: [String], minItems: 1, maxItems: BULK_RUN_CASES_MAX_ITEMS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_RUN_CASES_MAX_ITEMS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  runCaseIds!: string[];
}

export class AssignRunCasesDto extends RunCaseIdsDto {
  /** Who should test the cases: a user with access to the project, or null to unassign them. */
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((dto: AssignRunCasesDto) => dto.assigneeId !== null)
  @IsString()
  @IsNotEmpty()
  assigneeId!: string | null;
}
