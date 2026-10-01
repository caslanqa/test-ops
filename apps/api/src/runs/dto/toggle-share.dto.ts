import { IsBoolean } from "class-validator";

export class ToggleShareDto {
  @IsBoolean()
  enabled!: boolean;
}
