import { IsArray, IsOptional, IsString } from "class-validator";

export class CreatePlanDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  milestoneId?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  configuration?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  testCaseIds?: string[];
}
