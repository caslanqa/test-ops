import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "slug may only contain lowercase letters, digits and hyphens",
  })
  slug!: string;
}
