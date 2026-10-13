import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsEnum, MaxLength } from "class-validator";
import { WorkspaceRole } from "@prisma/client";

export class CreateInvitationDto {
  /** The address of the person to invite; only the account with this email can accept. */
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ enum: WorkspaceRole, enumName: "WorkspaceRole" })
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
