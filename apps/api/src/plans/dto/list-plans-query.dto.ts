import { IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListPlansQueryDto extends PageQueryDto {
  /** Case-insensitive text to look for in the title. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Only plans attached to this milestone. */
  @IsOptional()
  @IsString()
  milestoneId?: string;
}
