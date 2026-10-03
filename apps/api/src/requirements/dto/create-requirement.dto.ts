import { IsOptional, IsString } from "class-validator";

export class CreateRequirementDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  // External system reference (ID/URL) - content sync is out of MVP scope (see design-doc.md section 11)
  @IsOptional()
  @IsString()
  externalRef?: string;
}
