import { IsOptional, IsString } from "class-validator";

export class CreateRequirementDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Dış sistem referansı (ID/URL) - içerik senkronizasyonu MVP dışı (bkz. design-doc.md bölüm 11)
  @IsOptional()
  @IsString()
  externalRef?: string;
}
