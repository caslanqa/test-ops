import { IsOptional, IsString } from "class-validator";

export class TestCaseStepDto {
  @IsString()
  action!: string;

  @IsOptional()
  @IsString()
  expectedResult?: string;
}
