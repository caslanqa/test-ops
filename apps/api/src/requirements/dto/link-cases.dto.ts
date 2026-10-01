import { ArrayNotEmpty, IsArray, IsString } from "class-validator";

export class LinkCasesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  testCaseIds!: string[];
}
