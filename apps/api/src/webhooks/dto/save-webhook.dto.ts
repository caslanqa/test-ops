import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";

/** Most extra headers one webhook sends. */
export const WEBHOOK_HEADERS_MAX = 10;

export class WebhookHeaderDto {
  /** An HTTP header name, e.g. Authorization. */
  @IsString()
  @Matches(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/, { message: "name must be a valid HTTP header name" })
  name!: string;

  /** Its value; stored encrypted and never returned. */
  @IsString()
  @MaxLength(2000)
  @Matches(/^[^\r\n]*$/, { message: "value can't contain line breaks" })
  value!: string;
}

export class SaveWebhookDto {
  /**
   * Where to POST when a run starts with cases for automation, e.g.
   * https://api.github.com/repos/OWNER/REPO/dispatches for GitHub Actions.
   */
  @IsString()
  @MaxLength(2000)
  url!: string;

  /** Extra request headers; leave out to keep the saved ones, or send [] to remove them. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WEBHOOK_HEADERS_MAX)
  @ValidateNested({ each: true })
  @Type(() => WebhookHeaderDto)
  headers?: WebhookHeaderDto[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
