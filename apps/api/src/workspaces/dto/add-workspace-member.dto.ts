import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import { WorkspaceRole } from "@prisma/client";

export class AddWorkspaceMemberDto {
  @IsEmail()
  email!: string;

  // Required to create a new account if the user does not exist yet
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
