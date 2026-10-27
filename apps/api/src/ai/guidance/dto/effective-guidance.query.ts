import { ApiPropertyOptional } from "@nestjs/swagger";
import { AiGuidanceStep } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export const EFFECTIVE_SELECTIONS = ["EFFECTIVE", "NONE", "LIST"] as const;
export const EFFECTIVE_FORMATS = ["json", "prompt"] as const;

export class EffectiveGuidanceQuery {
  /** The step to resolve for; default DESIGN. */
  @IsOptional()
  @ApiPropertyOptional({ enum: AiGuidanceStep, enumName: "AiGuidanceStep" })
  @IsEnum(AiGuidanceStep)
  step?: AiGuidanceStep;

  /** What to resolve: what applies now (default), nothing, or the named guidance (`ids`). */
  @IsOptional()
  @ApiPropertyOptional({ enum: EFFECTIVE_SELECTIONS })
  @IsIn(EFFECTIVE_SELECTIONS)
  selection?: (typeof EFFECTIVE_SELECTIONS)[number];

  /** `json` (default): the guidance used and left out, with their text; `prompt`: the exact block, as plain text. */
  @IsOptional()
  @ApiPropertyOptional({ enum: EFFECTIVE_FORMATS })
  @IsIn(EFFECTIVE_FORMATS)
  format?: (typeof EFFECTIVE_FORMATS)[number];

  /** With `selection=LIST` only: guidance ids, separated by commas; one to twenty. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ids?: string;
}
