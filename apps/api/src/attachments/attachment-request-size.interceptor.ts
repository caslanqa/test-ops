import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

/** Multipart sınırları ve parça başlıkları için tolerans; kesin toplam kontrolü serviste yapılır. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/**
 * FR-045: istek başına toplam boyut sınırını, gövde okunmadan `Content-Length`
 * üzerinden uygular. Multer'ın toplam boyut limiti olmadığından bu kontrol
 * olmadan sınırı aşan bir istek önce tamamen diske yazılır, sonra reddedilir.
 * Controller seviyesinde tanımlandığı için metot seviyesindeki
 * FilesInterceptor'dan önce çalışır.
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
        `İstek başına toplam dosya boyutu ${maxRequestSize} baytı aşıyor`,
      );
    }
    return next.handle();
  }
}
