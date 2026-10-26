import { ApiProperty } from "@nestjs/swagger";
import { AiProviderKind } from "@prisma/client";
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
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  credential?: string;

  /** Removes the saved key. */
  @IsOptional()
  @IsBoolean()
  clearCredential?: boolean;

  /** Only possible after a passing connection test of the saved settings. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

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
