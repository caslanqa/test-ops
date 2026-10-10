import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreatePlanDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  milestoneId?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  configuration?: string;

  /** The plan's cases, in the order runs will list them. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  testCaseIds?: string[];

  /** Assigns all of these cases to this person (a user with access to the project). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  assigneeId?: string;
}
