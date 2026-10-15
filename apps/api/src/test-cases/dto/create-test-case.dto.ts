import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import {
  AutomationStatus,
  CasePriority,
  CaseSeverity,
  CaseType,
} from "@prisma/client";
import { TestCaseStepDto } from "./test-case-step.dto";

/** Most requirements one case can be linked to in a single request. */
export const REQUIREMENT_LINKS_MAX = 200;

export class CreateTestCaseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  suiteId?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  preconditions?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @ApiPropertyOptional({ enum: CasePriority, enumName: "CasePriority" })
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @IsOptional()
  @ApiPropertyOptional({ enum: CaseSeverity, enumName: "CaseSeverity" })
  @IsEnum(CaseSeverity)
  severity?: CaseSeverity;

  @IsOptional()
  @ApiPropertyOptional({ enum: CaseType, enumName: "CaseType" })
  @IsEnum(CaseType)
  type?: CaseType;

  @IsOptional()
  @ApiPropertyOptional({ enum: AutomationStatus, enumName: "AutomationStatus" })
  @IsEnum(AutomationStatus)
  automationStatus?: AutomationStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestCaseStepDto)
  steps?: TestCaseStepDto[];
  /**
   * Requirements of the same project this case covers. On update the list replaces the case's
   * links; leave it out to keep them, or send [] to remove them all.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REQUIREMENT_LINKS_MAX)
  @IsString({ each: true })
  requirementIds?: string[];
}
