import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateMilestoneDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
