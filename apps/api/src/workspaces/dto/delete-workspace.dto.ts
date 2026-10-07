import { IsString } from "class-validator";

export class DeleteWorkspaceDto {
  /** The workspace's exact name, repeated to confirm that everything in it is deleted. */
  @IsString()
  confirmName!: string;
}
