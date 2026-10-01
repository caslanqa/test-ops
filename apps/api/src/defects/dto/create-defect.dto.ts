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

  // ör. Jira, GitHub, GitLab, Azure DevOps, Linear, Trello, YouTrack, custom
  @IsOptional()
  @IsString()
  externalProvider?: string;

  @IsOptional()
  @IsString()
  externalIssueId?: string;

  @IsOptional()
  @IsString()
  externalUrl?: string;

  // Failed sonuçtan defect açma akışı için (FR-044)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resultIds?: string[];
}
