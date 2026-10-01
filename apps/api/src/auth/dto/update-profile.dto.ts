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

  // bcrypt yalnızca ilk 72 baytı kullanır; daha uzun parola güvenlik vaat etmez.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
