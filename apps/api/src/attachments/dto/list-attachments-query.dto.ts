import { IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListAttachmentsQueryDto extends PageQueryDto {
  /** Only attachments of this result. */
  @IsOptional()
  @IsString()
  resultId?: string;

  /** Only attachments of this defect. */
  @IsOptional()
  @IsString()
  defectId?: string;

  /** Case-insensitive text to look for in the file name. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
