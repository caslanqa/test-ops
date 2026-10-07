import { IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListRequirementCasesQueryDto extends PageQueryDto {
  /** Case-insensitive text to look for in the case title. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
