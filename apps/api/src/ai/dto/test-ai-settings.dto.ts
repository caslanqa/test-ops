import { ApiPropertyOptional } from "@nestjs/swagger";
import { AiOutputMode, AiProviderKind } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * The values of the settings form, to test before saving them. Leave the whole body out to test what is saved.
 * `provider` and `model` go together: sending one without the other is a mistake and answers 400.
 */
export class TestAiSettingsDto {
  @IsOptional()
  @ApiPropertyOptional({ enum: AiProviderKind, enumName: "AiProviderKind" })
  @IsEnum(AiProviderKind)
  provider?: AiProviderKind;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  endpoint?: string;

  /**
   * The provider key typed in the form. Left out, the saved key is used when the endpoint is the saved one;
   * for another endpoint no key is sent, as when saving.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  credential?: string;

  /** How to ask: a way, or AUTO (the default), which tries them in turn and says which one worked. */
  @IsOptional()
  @ApiPropertyOptional({ enum: AiOutputMode, enumName: "AiOutputMode" })
  @IsEnum(AiOutputMode)
  outputMode?: AiOutputMode;

  /** The saved key is being removed, so the test sends none. */
  @IsOptional()
  @IsBoolean()
  clearCredential?: boolean;
}
