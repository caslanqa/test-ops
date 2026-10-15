import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ExecutionMode } from "@prisma/client";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from "class-validator";

/** Most cases one request changes; the same limit as bulk result submission (FR-074). */
export const BULK_PLAN_CASES_MAX_ITEMS = 500;

/**
 * What can be set on a case of a plan: who tests it, and how it runs. A field left out stays as
 * it is; at least one is needed. Runs started from the plan take both over.
 */
export class UpdatePlanCaseDto {
  /** Who should test the case: a user with access to the project, or null to unassign it. */
  @ApiPropertyOptional({ type: String, nullable: true })
  @ValidateIf((dto: UpdatePlanCaseDto) => dto.assigneeId !== null && dto.assigneeId !== undefined)
  @IsString()
  @IsNotEmpty()
  assigneeId?: string | null;

  /** How runs started from the plan run the case: MANUAL (a tester) or AUTOMATED (CI). */
  @ApiPropertyOptional({ enum: ExecutionMode, enumName: "ExecutionMode" })
  @IsOptional()
  @IsEnum(ExecutionMode)
  executionMode?: ExecutionMode;
}

/** Changes several cases of a plan at once (all or none). */
export class UpdatePlanCasesDto extends UpdatePlanCaseDto {
  // The CLI plugin doesn't translate the array size rules, so the limits are stated here.
  @ApiProperty({ type: [String], minItems: 1, maxItems: BULK_PLAN_CASES_MAX_ITEMS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_PLAN_CASES_MAX_ITEMS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  testCaseIds!: string[];
}
