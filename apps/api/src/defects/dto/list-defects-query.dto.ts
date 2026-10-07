import { ApiPropertyOptional } from "@nestjs/swagger";
import { DefectSeverity, DefectStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListDefectsQueryDto extends PageQueryDto {
  /** Case-insensitive text to look for in the title. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: DefectStatus, enumName: "DefectStatus" })
  @IsOptional()
  @IsEnum(DefectStatus)
  status?: DefectStatus;

  @ApiPropertyOptional({ enum: DefectSeverity, enumName: "DefectSeverity" })
  @IsOptional()
  @IsEnum(DefectSeverity)
  severity?: DefectSeverity;

  /** Only defects assigned to this user. */
  @IsOptional()
  @IsString()
  assigneeId?: string;
}
