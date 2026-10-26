import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsEnum, IsOptional, IsUUID, MaxLength } from "class-validator";
import { ProjectRole, WorkspaceRole } from "@prisma/client";

export class CreateInvitationDto {
  /** The address of the person to invite; only the account with this email can accept. */
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ enum: WorkspaceRole, enumName: "WorkspaceRole" })
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;

  /** A project of the workspace; given together with `projectRole`, and not with the ADMIN role. */
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  /** The role the person gets in `projectId` when they join. */
  @ApiPropertyOptional({ enum: ProjectRole, enumName: "ProjectRole" })
  @IsOptional()
  @IsEnum(ProjectRole)
  projectRole?: ProjectRole;
}
