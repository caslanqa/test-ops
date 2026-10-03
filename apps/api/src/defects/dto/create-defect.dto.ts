import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { DefectSeverity } from "@prisma/client";

export class CreateDefectDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(DefectSeverity)
  severity?: DefectSeverity;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  // e.g. Jira, GitHub, GitLab, Azure DevOps, Linear, Trello, YouTrack, custom
  @IsOptional()
  @IsString()
  externalProvider?: string;

  @IsOptional()
  @IsString()
  externalIssueId?: string;

  @IsOptional()
  @IsString()
  externalUrl?: string;

  // For the flow that opens a defect from a failed result (FR-044)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resultIds?: string[];
}
