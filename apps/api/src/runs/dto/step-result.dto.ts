import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsInt, IsOptional, IsString } from "class-validator";
import { ResultStatus } from "@prisma/client";

export class StepResultDto {
  @IsInt()
  stepPosition!: number;

  @ApiProperty({ enum: ResultStatus, enumName: "ResultStatus" })
  @IsEnum(ResultStatus)
  status!: ResultStatus;

  @IsOptional()
  @IsString()
  comment?: string;
}
