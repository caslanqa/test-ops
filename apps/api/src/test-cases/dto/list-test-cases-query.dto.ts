import { ApiPropertyOptional } from "@nestjs/swagger";
import { AutomationStatus, CasePriority, CaseSeverity, CaseType } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

export class ListTestCasesQueryDto extends PageQueryDto {
  /** Only cases directly in this suite. */
  @IsOptional()
  @IsString()
  suiteId?: string;

  /** Include archived cases (excluded by default). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  includeArchived?: boolean;

  /** Case-insensitive text to look for in the title. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: CasePriority, enumName: "CasePriority" })
  @IsOptional()
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @ApiPropertyOptional({ enum: CaseSeverity, enumName: "CaseSeverity" })
  @IsOptional()
  @IsEnum(CaseSeverity)
  severity?: CaseSeverity;

  @ApiPropertyOptional({ enum: CaseType, enumName: "CaseType" })
  @IsOptional()
  @IsEnum(CaseType)
  type?: CaseType;

  @ApiPropertyOptional({ enum: AutomationStatus, enumName: "AutomationStatus" })
  @IsOptional()
  @IsEnum(AutomationStatus)
  automationStatus?: AutomationStatus;
}
