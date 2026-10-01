import { ArrayNotEmpty, IsArray, IsString } from "class-validator";

export class LinkResultsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  resultIds!: string[];
}
