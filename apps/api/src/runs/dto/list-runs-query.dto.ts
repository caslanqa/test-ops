import { ApiPropertyOptional } from "@nestjs/swagger";
import { RunStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListRunsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: RunStatus, enumName: "RunStatus" })
  @IsOptional()
  @IsEnum(RunStatus)
  status?: RunStatus;

  /** Case-insensitive text to look for in the title. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Only runs created from this plan. */
  @IsOptional()
  @IsString()
  planId?: string;

  /** Only runs attached to this milestone. */
  @IsOptional()
  @IsString()
  milestoneId?: string;

  /** Only runs with at least one case assigned to this user, e.g. the signed-in tester's own. */
  @IsOptional()
  @IsString()
  assigneeId?: string;
}
