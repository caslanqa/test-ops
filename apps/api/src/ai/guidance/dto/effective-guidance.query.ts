import { ApiPropertyOptional } from "@nestjs/swagger";
import { AiGuidanceStep } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export const GUIDANCE_FORMATS = ["json", "prompt", "markdown"] as const;

/** What both views of resolved guidance take: the step, and how to answer. */
class GuidanceViewQuery {
  /** The step to resolve for; default DESIGN. */
  @IsOptional()
  @ApiPropertyOptional({ enum: AiGuidanceStep, enumName: "AiGuidanceStep" })
  @IsEnum(AiGuidanceStep)
  step?: AiGuidanceStep;

  /**
   * `json` (default): the guidance used and left out, with their text; `prompt`: the exact block added to a step's
   * prompt, as plain text; `markdown`: one document, for a coding agent to read.
   */
  @IsOptional()
  @ApiPropertyOptional({ enum: GUIDANCE_FORMATS })
  @IsIn(GUIDANCE_FORMATS)
  format?: (typeof GUIDANCE_FORMATS)[number];
}

/** What any project member (and an API token) may read: what applies to the project now, or nothing. */
export class EffectiveGuidanceQuery extends GuidanceViewQuery {
  @IsOptional()
  @ApiPropertyOptional({ enum: ["EFFECTIVE", "NONE"] })
  @IsIn(["EFFECTIVE", "NONE"])
  selection?: "EFFECTIVE" | "NONE";
}

/**
 * What a project admin may preview: also exactly the named guidance, switched on or not. That is the text of
 * guidance that is not in effect, which only admins may read, so it has a route of its own.
 */
export class PreviewGuidanceQuery extends GuidanceViewQuery {
  @IsOptional()
  @ApiPropertyOptional({ enum: ["EFFECTIVE", "NONE", "LIST"] })
  @IsIn(["EFFECTIVE", "NONE", "LIST"])
  selection?: "EFFECTIVE" | "NONE" | "LIST";

  /** With `selection=LIST` only: guidance ids, separated by commas; one to twenty. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ids?: string;
}
