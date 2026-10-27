import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { GUIDANCE_LIMITS } from "../guidance-limits";

/** A markdown file the browser read: sent as text, so nothing is uploaded or fetched by the server. */
export class ImportPreviewDto {
  /** Shown as the source of the guidance; never opened. */
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(GUIDANCE_LIMITS.sourceName)
  fileName!: string;

  /** The file's text; at most 100000 bytes, and no NUL characters (checked by the service, which says why). */
  @IsString()
  content!: string;
}
