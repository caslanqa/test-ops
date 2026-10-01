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

  // Kullanıcı henüz yoksa yeni hesap oluşturmak için gerekli
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
