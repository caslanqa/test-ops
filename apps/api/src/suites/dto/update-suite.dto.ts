import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { MAX_INT32 } from "../../common/limits";

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
  @IsNotEmpty()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_INT32)
  position?: number;
}
