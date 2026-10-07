import { IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListMilestonesQueryDto extends PageQueryDto {
  /** Case-insensitive text to look for in the name. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
