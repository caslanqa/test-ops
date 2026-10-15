import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsString, ValidateIf } from "class-validator";

/** Most cases one request assigns; the same limit as bulk result submission (FR-074). */
export const BULK_PLAN_CASES_MAX_ITEMS = 500;

/** Assigns several cases of a plan at once; runs started from the plan take the assignees over. */
export class AssignPlanCasesDto {
  // The CLI plugin doesn't translate the array size rules, so the limits are stated here.
  @ApiProperty({ type: [String], minItems: 1, maxItems: BULK_PLAN_CASES_MAX_ITEMS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_PLAN_CASES_MAX_ITEMS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  testCaseIds!: string[];

  /** Who should test the cases: a user with access to the project, or null to unassign them. */
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((dto: AssignPlanCasesDto) => dto.assigneeId !== null)
  @IsString()
  @IsNotEmpty()
  assigneeId!: string | null;
}
