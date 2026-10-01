import { IsEnum } from "class-validator";
import { WorkspaceRole } from "@prisma/client";

export class UpdateWorkspaceMemberRoleDto {
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
