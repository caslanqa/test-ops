import { IsEnum, IsInt, IsOptional, IsString } from "class-validator";
import { ResultStatus } from "@prisma/client";

export class StepResultDto {
  @IsInt()
  stepPosition!: number;

  @IsEnum(ResultStatus)
  status!: ResultStatus;

  @IsOptional()
  @IsString()
  comment?: string;
}
