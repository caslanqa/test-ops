import { ApiProperty } from "@nestjs/swagger";
import { IsEnum } from "class-validator";
import { ProjectRole } from "@prisma/client";

export class UpdateProjectMemberRoleDto {
  @ApiProperty({ enum: ProjectRole, enumName: "ProjectRole" })
  @IsEnum(ProjectRole)
  role!: ProjectRole;
}
