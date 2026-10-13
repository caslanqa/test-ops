import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class AddPlanCasesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  testCaseIds!: string[];

  /** Assigns the added cases to this person (a user with access to the project). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  assigneeId?: string;
}
