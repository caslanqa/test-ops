import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateProjectDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,20}$/, {
    message: "key must be 2–20 characters: uppercase letters, digits, hyphens or underscores",
  })
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
