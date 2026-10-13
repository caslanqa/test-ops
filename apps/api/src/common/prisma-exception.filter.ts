import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

const NUMBER_OUT_OF_RANGE = "A number is outside the range that can be stored.";
/** Seconds a client is asked to wait before retrying after a pool or transaction timeout. */
const RETRY_AFTER_SECONDS = 2;
const NUL_CHARACTER = "Text can't contain the NUL character (\\u0000).";

type PrismaRequestError =
  | Prisma.PrismaClientKnownRequestError
  | Prisma.PrismaClientUnknownRequestError;

/**
 * Answers database errors that the request caused with 4xx instead of 500: a unique value
 * taken by a parallel request, a record deleted in the meantime, a reference that doesn't
 * exist or is still in use, and values PostgreSQL can't store. The services and DTOs check
 * these up front; this covers races and input no rule catches. Any other error is handled
 * as before (500, logged). Pool and transaction timeouts (P2024, P2028) are overload, not a bad
 * request: they get 503 with Retry-After. Every mapped error is logged at warn level, because the
 * same codes can also come from a server bug that a 4xx would otherwise hide.
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: PrismaRequestError, host: ArgumentsHost) {
    const mapped = toHttpException(exception);
    if (mapped) {
      const http = host.switchToHttp();
      const request = http.getRequest<Request>();
      this.logger.warn(
        `${request.method} ${request.originalUrl ?? request.url}: ${describe(exception)} -> ${mapped.getStatus()}`,
      );
      if (mapped instanceof ServiceUnavailableException) {
        http.getResponse<Response>().setHeader("Retry-After", String(RETRY_AFTER_SECONDS));
      }
    }
    super.catch(mapped ?? exception, host);
  }
}

/** "P2002 on ProjectMember (userId, projectId)": the code, model and target of the error. */
function describe(error: PrismaRequestError) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return `unknown request error (${error.message.split("\n").pop()?.trim()})`;
  }
  const meta = error.meta ?? {};
  const model = typeof meta.modelName === "string" ? ` on ${meta.modelName}` : "";
  const target = Array.isArray(meta.target)
    ? ` (${meta.target.join(", ")})`
    : typeof meta.target === "string"
      ? ` (${meta.target})`
      : typeof meta.constraint === "string" || Array.isArray(meta.constraint)
        ? ` (${[meta.constraint].flat().join(", ")})`
        : typeof meta.field_name === "string"
          ? ` (${meta.field_name})`
          : "";
  const pg = typeof meta.code === "string" ? ` [postgres ${meta.code}]` : "";
  return `${error.code}${model}${target}${pg}`;
}

export function toHttpException(error: PrismaRequestError): HttpException | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        return new ConflictException(uniqueMessage(error.meta));
      case "P2025":
        return new NotFoundException("The record was not found; it may have just been deleted.");
      case "P2003":
        return new ConflictException("A related record doesn't exist or is still in use.");
      case "P2000":
        return new BadRequestException("A value is too long for its field.");
      case "P2020":
      case "P2033":
        return new BadRequestException(NUMBER_OUT_OF_RANGE);
      case "P2024":
      case "P2028":
        return new ServiceUnavailableException(
          "The server is busy; retry the request in a moment.",
        );
      case "P2010":
        // Raw queries ($queryRaw) carry the PostgreSQL error code instead.
        return fromPostgresCode(String(error.meta?.code ?? ""));
    }
    return undefined;
  }
  // Prisma reports these two as unknown errors, so they are recognized by the database message.
  if (/invalid byte sequence|\b22021\b/.test(error.message)) {
    return new BadRequestException(NUL_CHARACTER);
  }
  if (/Unable to fit integer value/.test(error.message)) {
    return new BadRequestException(NUMBER_OUT_OF_RANGE);
  }
  return undefined;
}

function fromPostgresCode(code: string): HttpException | undefined {
  switch (code) {
    case "23505":
      return new ConflictException(uniqueMessage(undefined));
    case "23503":
      return new ConflictException("A related record doesn't exist or is still in use.");
    case "22021":
      return new BadRequestException(NUL_CHARACTER);
    case "22003":
      return new BadRequestException(NUMBER_OUT_OF_RANGE);
  }
  return undefined;
}

/** "A workspace with this slug already exists." ID columns are left out of the field list. */
function uniqueMessage(meta: Record<string, unknown> | undefined) {
  const model = typeof meta?.modelName === "string" ? words(meta.modelName) : "record";
  const target = Array.isArray(meta?.target) ? (meta.target as string[]) : [];
  const fields = target.filter((field) => !/Id$/.test(field)).map(words);
  const what = fields.length > 0 ? `this ${fields.join(" and ")}` : "these details";
  return `${/^[aeiou]/.test(model) ? "An" : "A"} ${model} with ${what} already exists.`;
}

/** "ProjectMember" → "project member". */
function words(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}
