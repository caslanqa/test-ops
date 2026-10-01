import { PartialType, OmitType } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { DefectStatus } from "@prisma/client";
import { CreateDefectDto } from "./create-defect.dto";

export class UpdateDefectDto extends PartialType(
  OmitType(CreateDefectDto, ["resultIds"] as const),
) {
  @IsOptional()
  @IsEnum(DefectStatus)
  status?: DefectStatus;
}
