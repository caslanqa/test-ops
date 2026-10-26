import { IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListRunsQueryDto extends PageQueryDto {
  /** Only the runs started for this requirement. */
  @IsOptional()
  @IsString()
  requirementId?: string;
}
