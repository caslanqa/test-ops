import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { AiOutputMode, AiProviderKind } from "@prisma/client";
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/** The ranges of the numeric settings; the documented defaults are 8192, 120000 and 20. */
export const AI_MAX_OUTPUT_TOKENS = { min: 256, max: 32000 };
export const AI_REQUEST_TIMEOUT_MS = { min: 5000, max: 600000 };
export const AI_RUNS_PER_USER_PER_DAY = { min: 1, max: 1000 };

export class SaveAiSettingsDto {
  @ApiProperty({ enum: AiProviderKind, enumName: "AiProviderKind" })
  @IsEnum(AiProviderKind)
  provider!: AiProviderKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model!: string;

  /**
   * OpenAI-compatible (required): the base URL including /v1, e.g. http://localhost:11434/v1.
   * Anthropic (optional): the base URL; leave it out for the public API.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  endpoint?: string;

  /**
   * The provider key; stored encrypted and never returned. Leave it out to keep the saved one, as long as the
   * endpoint stays the same: pointing the setting at another endpoint drops the saved key.
   */
  @IsOptional()
  // A key pasted with a trailing line break would otherwise be saved with it and fail later as an invalid header.
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  credential?: string;

  /** Removes the saved key. */
  @IsOptional()
  @IsBoolean()
  clearCredential?: boolean;

  /**
   * How an OpenAI-compatible server is asked for a structured answer: AUTO (default) tries a JSON schema, a tool
   * call and json_object in turn and remembers what worked; the others pin one way. Left out, the saved one stays.
   */
  @IsOptional()
  @ApiPropertyOptional({ enum: AiOutputMode, enumName: "AiOutputMode" })
  @IsEnum(AiOutputMode)
  outputMode?: AiOutputMode;

  /** Only possible after a passing connection test: of the saved settings, or of these values (see `testProof`). */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /**
   * The `proof` a passing test of exactly these values returned. It lets the values be saved as tested, so a form
   * can test first and save and switch on afterwards. It is bound to the workspace or project, the provider, model,
   * endpoint and key, and expires after ten minutes; anything else ignores it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  testProof?: string;

  @IsOptional()
  @IsInt()
  @Min(AI_MAX_OUTPUT_TOKENS.min)
  @Max(AI_MAX_OUTPUT_TOKENS.max)
  maxOutputTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(AI_REQUEST_TIMEOUT_MS.min)
  @Max(AI_REQUEST_TIMEOUT_MS.max)
  requestTimeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(AI_RUNS_PER_USER_PER_DAY.min)
  @Max(AI_RUNS_PER_USER_PER_DAY.max)
  maxRunsPerUserPerDay?: number;
}
