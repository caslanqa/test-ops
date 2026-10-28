import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { CasePriority, CaseType } from "@prisma/client";

/** The most drafts one approval writes; the workflow never drafts more. */
export const APPROVE_MAX_CASES = 25;
const DRAFT_KINDS = ["positive", "negative", "boundary", "error"] as const;

const trimmed = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class DraftStepDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  action!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  expectedResult?: string;
}

/** A draft as a person approves it, possibly edited: the case fields of CreateTestCaseDto, and the kind of case. */
export class CaseDraftDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preconditions?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => DraftStepDto)
  steps?: DraftStepDto[];

  @IsOptional()
  @ApiPropertyOptional({ enum: CasePriority, enumName: "CasePriority" })
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @IsOptional()
  @ApiPropertyOptional({ enum: CaseType, enumName: "CaseType" })
  @IsEnum(CaseType)
  type?: CaseType;

  /** Becomes a tag of the case, next to "ai-generated". */
  @ApiProperty({ enum: DRAFT_KINDS })
  @IsIn(DRAFT_KINDS)
  kind!: (typeof DRAFT_KINDS)[number];
}

export class ApproveRunDto {
  /** The suite the cases go into; it must belong to the project. Leave it out to put them at the top level. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  suiteId?: string;

  /** The drafts to write, as the person left them; drafts that are not sent are never written. */
  @ApiProperty({ type: [CaseDraftDto], minItems: 1, maxItems: APPROVE_MAX_CASES })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(APPROVE_MAX_CASES)
  @ValidateNested({ each: true })
  @Type(() => CaseDraftDto)
  cases!: CaseDraftDto[];
}
