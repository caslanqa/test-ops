import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { AttachmentsService } from "./attachments.service";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentRequestSizeInterceptor } from "./attachment-request-size.interceptor";
import { ATTACHMENT_TMP_DIRNAME } from "./attachments.constants";

@Module({
  imports: [
    // Yüklemeler RAM yerine attachment volume'u içindeki geçici dizine yazılır;
    // böylece büyük istekler belleği tüketmez ve dosya son konumuna aynı dosya
    // sisteminde atomik rename ile taşınır. Limitler FilesInterceptor'a modül
    // seçeneği olarak geçer, yani tek kaynak ATTACHMENT_* env değerleridir.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const tmpDir = path.join(
          config.get<string>("attachments.dir")!,
          ATTACHMENT_TMP_DIRNAME,
        );
        fs.mkdirSync(tmpDir, { recursive: true });
        return {
          storage: diskStorage({
            destination: tmpDir,
            filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
          }),
          limits: {
            fileSize: config.get<number>("attachments.maxFileSizeBytes"),
            files: config.get<number>("attachments.maxFilesPerRequest"),
          },
        };
      },
    }),
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentRequestSizeInterceptor],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
