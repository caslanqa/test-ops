import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { ResultStatus } from "@prisma/client";
import { MAX_INT32 } from "../../common/limits";

export class StepResultDto {
  @IsInt()
  @Min(0)
  @Max(MAX_INT32)
  stepPosition!: number;

  @ApiProperty({ enum: ResultStatus, enumName: "ResultStatus" })
  @IsEnum(ResultStatus)
  status!: ResultStatus;

  @IsOptional()
  @IsString()
  comment?: string;
}
