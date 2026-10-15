import { IsString } from "class-validator";

export class DeleteProjectDto {
  /** The project's exact key, repeated to confirm that everything in it is deleted. */
  @IsString()
  confirmKey!: string;
}
