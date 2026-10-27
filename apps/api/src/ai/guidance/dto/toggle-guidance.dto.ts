import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class ToggleGuidanceDto {
  /** A built-in pack, by its key. Name this or `guidanceId`, not both. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: "builtinKey must be lower-case letters, digits and dashes" })
  builtinKey?: string;

  /** A guidance of the project's workspace, switched on or off for the project (project routes only). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  guidanceId?: string;

  @IsBoolean()
  enabled!: boolean;
}
