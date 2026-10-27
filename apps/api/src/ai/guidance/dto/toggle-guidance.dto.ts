import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from "class-validator";

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

  /** On or off; `null` clears this owner's own switch, so a project follows its workspace again. */
  @ApiProperty({ type: Boolean, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  enabled!: boolean | null;
}
