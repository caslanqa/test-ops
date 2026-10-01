import { PartialType, OmitType } from "@nestjs/swagger";
import { CreatePlanDto } from "./create-plan.dto";

export class UpdatePlanDto extends PartialType(
  OmitType(CreatePlanDto, ["testCaseIds"] as const),
) {}
