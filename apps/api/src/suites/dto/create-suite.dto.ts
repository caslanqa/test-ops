import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateSuiteDto {
  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  parentId?: string;
}
