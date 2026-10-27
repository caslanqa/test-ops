import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { AiWorkflowType } from "@prisma/client";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { GUIDANCE_LIMITS } from "../guidance/guidance-limits";

/** The most extra context a person can add to a run. */
export const EXTRA_CONTEXT_MAX_CHARS = 8000;

/** Which of the team's guidance a run is sent: what applies now (default), none, or exactly the named guidance. */
export class GuidanceSelectionDto {
  @ApiProperty({ enum: ["EFFECTIVE", "NONE", "LIST"] })
  @IsIn(["EFFECTIVE", "NONE", "LIST"])
  mode!: "EFFECTIVE" | "NONE" | "LIST";

  /** With `LIST` only: one to twenty guidance ids of the project or its workspace, switched on or not. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(GUIDANCE_LIMITS.selectionIds)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  ids?: string[];
}

export class StartRunDto {
  @ApiProperty({ enum: AiWorkflowType, enumName: "AiWorkflowType" })
  @IsEnum(AiWorkflowType)
  type!: AiWorkflowType;

  /** The requirement to draft test cases for; it must belong to the project and not be archived. */
  @IsString()
  @IsNotEmpty()
  requirementId!: string;

  /** Notes for the model, such as "mention the mobile app"; sent along with the requirement. */
  @IsOptional()
  @IsString()
  @MaxLength(EXTRA_CONTEXT_MAX_CHARS)
  extraContext?: string;

  /**
   * The team's guidance to send along: left out, what applies to the project now. It is resolved when the run
   * starts and the run keeps it, so editing guidance later changes nothing about a run in progress.
   */
  @IsOptional()
  @ApiPropertyOptional({ type: GuidanceSelectionDto })
  @ValidateNested()
  @Type(() => GuidanceSelectionDto)
  guidance?: GuidanceSelectionDto;
}
