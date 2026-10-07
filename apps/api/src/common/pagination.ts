import { applyDecorators } from "@nestjs/common";
import { ApiResponse } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import type { Response } from "express";

/** Upper bound for one page; keeps a single request from loading an unbounded table. */
export const MAX_PAGE_SIZE = 500;

/** Response header carrying the number of items that match the filters, across all pages. */
export const TOTAL_COUNT_HEADER = "X-Total-Count";

/**
 * Paging query parameters shared by every list endpoint (FR-072). List responses stay plain
 * arrays so existing clients keep working; the total comes in the `X-Total-Count` header.
 * Without `limit` everything is returned, as before pagination existed.
 */
export class PageQueryDto {
  /**
   * Maximum number of items to return (1-500). Omit to return all items.
   * @example 50
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  /**
   * Number of items to skip; combine with `limit` to walk through pages.
   * @example 0
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** One page of a list plus the total number of matching items. */
export interface Page<T> {
  items: T[];
  total: number;
}

/** Prisma `take`/`skip` for a page query. */
export function pageArgs(page: PageQueryDto): { take?: number; skip?: number } {
  return { take: page.limit, skip: page.offset };
}

/**
 * Sets the total count header and returns the items; used by controllers so the response
 * body stays a plain array.
 */
export function sendPage<T>(res: Response, page: Page<T>): T[] {
  res.setHeader(TOTAL_COUNT_HEADER, String(page.total));
  return page.items;
}

/** Documents the paging response header of a list endpoint in the OpenAPI document. */
export const PagedResponse = () =>
  applyDecorators(
    ApiResponse({
      status: 200,
      description: "The requested page of items, as a JSON array.",
      headers: {
        [TOTAL_COUNT_HEADER]: {
          description: "Number of items matching the filters across all pages.",
          schema: { type: "integer" },
        },
      },
    }),
  );
