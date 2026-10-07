import { ApiPropertyOptional, OmitType, PartialType } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { DefectStatus } from "@prisma/client";
import { CreateDefectDto } from "./create-defect.dto";

export class UpdateDefectDto extends PartialType(
  OmitType(CreateDefectDto, ["resultIds"] as const),
) {
  @IsOptional()
  @ApiPropertyOptional({ enum: DefectStatus, enumName: "DefectStatus" })
  @IsEnum(DefectStatus)
  status?: DefectStatus;
}
