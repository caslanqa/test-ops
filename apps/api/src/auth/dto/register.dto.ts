import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;

  // bcrypt yalnızca ilk 72 baytı kullanır; daha uzun parola güvenlik vaat etmez.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
