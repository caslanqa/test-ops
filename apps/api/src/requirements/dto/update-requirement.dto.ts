import { PartialType } from "@nestjs/swagger";
import { CreateRequirementDto } from "./create-requirement.dto";

export class UpdateRequirementDto extends PartialType(CreateRequirementDto) {}
