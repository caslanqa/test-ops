import { IsArray, IsOptional, IsString } from "class-validator";

export class UpdateRunDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  build?: string;

  @IsOptional()
  @IsString()
  configuration?: string;

  // e.g. JiraCloud, GitHub, GitLab, Azure DevOps, Linear, Trello, YouTrack, CustomField
  @IsOptional()
  @IsString()
  externalLinkType?: string;

  @IsOptional()
  @IsString()
  externalLinkRef?: string;
}
