import { ArrayNotEmpty, IsArray, IsString } from "class-validator";

export class AddPlanCasesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  testCaseIds!: string[];
}
