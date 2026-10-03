import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

/** Allowance for multipart boundaries and part headers; the exact total check happens in the service. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/**
 * FR-045: enforces the total size limit per request via `Content-Length`, before
 * the body is read. Multer has no total size limit, so without this check an
 * oversized request would first be written to disk in full, then rejected.
 * Because it is declared at controller level, it runs before the method-level
 * FilesInterceptor.
 */
@Injectable()
export class AttachmentRequestSizeInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    const maxRequestSize = this.config.get<number>(
      "attachments.maxRequestSizeBytes",
    )!;
    const declaredLength = Number(request.headers["content-length"]);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > maxRequestSize + MULTIPART_OVERHEAD_BYTES
    ) {
      throw new PayloadTooLargeException(
        `Total upload size exceeds ${maxRequestSize} bytes per request`,
      );
    }
    return next.handle();
  }
}
