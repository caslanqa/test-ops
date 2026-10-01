import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
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

export class CreateTestCaseDto {
  @IsOptional()
  @IsString()
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
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @IsOptional()
  @IsEnum(CaseSeverity)
  severity?: CaseSeverity;

  @IsOptional()
  @IsEnum(CaseType)
  type?: CaseType;

  @IsOptional()
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
}
