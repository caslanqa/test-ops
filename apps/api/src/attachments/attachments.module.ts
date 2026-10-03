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
    // Uploads are written to a temp directory inside the attachment volume instead of RAM;
    // that way large requests do not exhaust memory and the file is moved into place
    // with an atomic rename on the same filesystem. Limits reach FilesInterceptor as
    // module options, so the single source of truth is the ATTACHMENT_* env values.
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
