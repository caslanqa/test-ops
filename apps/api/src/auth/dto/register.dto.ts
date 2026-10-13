import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;

  // bcrypt only uses the first 72 bytes; a longer password promises no extra security.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  /**
   * Token of a workspace invitation link for this email: the new account joins that workspace,
   * and it can be created even when self-registration is off.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  inviteToken?: string;
}
