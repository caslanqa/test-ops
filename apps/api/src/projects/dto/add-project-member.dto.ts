import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsEnum } from "class-validator";
import { ProjectRole } from "@prisma/client";

export class AddProjectMemberDto {
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ProjectRole, enumName: "ProjectRole" })
  @IsEnum(ProjectRole)
  role!: ProjectRole;
}
