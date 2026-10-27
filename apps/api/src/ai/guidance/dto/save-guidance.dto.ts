import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { AiGuidanceKind, AiGuidanceSource, AiGuidanceStep } from "@prisma/client";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { GUIDANCE_LIMITS } from "../guidance-limits";

/** A pasted value often carries a trailing line break; it is not part of what the person meant. */
const trimmed = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class SaveGuidanceDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GUIDANCE_LIMITS.title)
  title!: string;

  /** One line saying what the guidance is for; shown in the lists, never sent to the model. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(GUIDANCE_LIMITS.summary)
  summary?: string;

  /** The text put into the prompt. Plain text: it is shown as text, never as HTML. */
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GUIDANCE_LIMITS.body)
  body!: string;

  @ApiProperty({ enum: AiGuidanceKind, enumName: "AiGuidanceKind" })
  @IsEnum(AiGuidanceKind)
  kind!: AiGuidanceKind;

  /** Where it applies: one to four of the steps, each once. */
  @ApiProperty({ enum: AiGuidanceStep, enumName: "AiGuidanceStep", isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsEnum(AiGuidanceStep, { each: true })
  steps!: AiGuidanceStep[];

  /** 0 to 1000, default 500. */
  @IsOptional()
  @IsInt()
  @Min(GUIDANCE_LIMITS.priority.min)
  @Max(GUIDANCE_LIMITS.priority.max)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ApiPropertyOptional({ enum: AiGuidanceSource, enumName: "AiGuidanceSource" })
  @IsEnum(AiGuidanceSource)
  sourceKind?: AiGuidanceSource;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(GUIDANCE_LIMITS.sourceName)
  sourceName?: string;

  /** Where the text came from, for attribution; shown as text and never fetched. */
  @IsOptional()
  @Transform(trimmed)
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(GUIDANCE_LIMITS.sourceUrl)
  sourceUrl?: string;

  /** Free text, such as "MIT"; shown with the guidance as attribution. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(GUIDANCE_LIMITS.license)
  license?: string;
}

/**
 * The same fields, each optional; only what is sent changes. `expectedVersion` is the version the person was looking at:
 * a change made from an older one is refused (409), not merged over what someone saved meanwhile.
 */
export class UpdateGuidanceDto extends PartialType(SaveGuidanceDto) {
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
