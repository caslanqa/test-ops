import { IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListProjectsQueryDto extends PageQueryDto {
  /** Case-insensitive text to look for in the project name or key. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Only projects of this workspace. */
  @IsOptional()
  @IsString()
  workspaceId?: string;
}
