import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

/** Longest lifetime a token can be given; a token without a lifetime doesn't expire. */
export const API_TOKEN_MAX_LIFETIME_DAYS = 365;

export class CreateApiTokenDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /**
   * Days until the token stops working (1-365). Omit it for a token that doesn't expire.
   * @example 90
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(API_TOKEN_MAX_LIFETIME_DAYS)
  expiresInDays?: number;
}
