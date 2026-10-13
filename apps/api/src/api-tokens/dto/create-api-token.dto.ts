import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

/** Longest lifetime a token can be given; only an explicit null gives a token that doesn't expire. */
export const API_TOKEN_MAX_LIFETIME_DAYS = 365;

export class CreateApiTokenDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /**
   * Days until the token stops working (1-365). Omit it for the default of 90 days; send `null`
   * for a token that never expires.
   * @example 90
   */
  @IsOptional() // skips the checks below for both undefined (default) and null (no expiration)
  @IsInt()
  @Min(1)
  @Max(API_TOKEN_MAX_LIFETIME_DAYS)
  expiresInDays?: number | null;
}
