import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListWorkspaceProjectsQueryDto extends PageQueryDto {
  /** Only archived projects (listed instead of the active ones), e.g. to restore one. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  archived?: boolean;
}
