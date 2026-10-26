import { ApiProperty } from "@nestjs/swagger";
import { AiWorkflowType } from "@prisma/client";
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

/** The most extra context a person can add to a run. */
export const EXTRA_CONTEXT_MAX_CHARS = 8000;

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
}
