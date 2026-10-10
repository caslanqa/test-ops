import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, ValidateIf } from "class-validator";

export class AssignCaseDto {
  /** Who should test the case: a user with access to the project, or null to unassign. */
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((dto: AssignCaseDto) => dto.assigneeId !== null)
  @IsString()
  @IsNotEmpty()
  assigneeId!: string | null;
}
