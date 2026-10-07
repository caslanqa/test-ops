import { ApiProperty } from "@nestjs/swagger";
import { IsEnum } from "class-validator";
import { WorkspaceRole } from "@prisma/client";

export class UpdateWorkspaceMemberRoleDto {
  @ApiProperty({ enum: WorkspaceRole, enumName: "WorkspaceRole" })
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
