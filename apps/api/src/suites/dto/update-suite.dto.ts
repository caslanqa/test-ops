import { IsInt, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateSuiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  position?: number;
}
