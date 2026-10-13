import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListRequirementsQueryDto extends PageQueryDto {
  /** Case-insensitive text to look for in the title. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Include archived ones (excluded by default). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  includeArchived?: boolean;
}
