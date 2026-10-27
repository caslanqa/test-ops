import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDefined, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { EXTRA_CONTEXT_MAX_CHARS, GuidanceSelectionDto } from "../../dto/start-run.dto";

/** Two runs of one requirement under two selections of guidance, to see which drafts better. */
export class StartComparisonDto {
  /** The requirement to draft test cases for; it must belong to the project and not be archived. */
  @IsString()
  @IsNotEmpty()
  requirementId!: string;

  /** Notes for the model, as for a single run; both sides get the same. */
  @IsOptional()
  @IsString()
  @MaxLength(EXTRA_CONTEXT_MAX_CHARS)
  extraContext?: string;

  /** The guidance of side A. */
  @ApiProperty({ type: GuidanceSelectionDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => GuidanceSelectionDto)
  a!: GuidanceSelectionDto;

  /** The guidance of side B; it must differ from side A. */
  @ApiProperty({ type: GuidanceSelectionDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => GuidanceSelectionDto)
  b!: GuidanceSelectionDto;
}

export class VerdictDto {
  @ApiProperty({ enum: ["A", "B", "NEITHER"] })
  @IsIn(["A", "B", "NEITHER"])
  preferred!: "A" | "B" | "NEITHER";

  /** Why, in a few words; kept with the verdict and never put into the audit log. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
