import { IsString, MaxLength, MinLength } from "class-validator";

export class UpdateProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  // bcrypt only uses the first 72 bytes; a longer password promises no extra security.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
