import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, ValidateIf } from "class-validator";
import { ProjectRole } from "@prisma/client";

export class SetProjectRoleDto {
  /** The member's role in the project, or null to take them out of it. */
  @ApiProperty({ enum: ProjectRole, enumName: "ProjectRole", nullable: true })
  @ValidateIf((dto: SetProjectRoleDto) => dto.role !== null)
  @IsEnum(ProjectRole)
  role!: ProjectRole | null;
}
