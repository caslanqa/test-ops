import * as fs from "fs";
import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AttachmentsService } from "./attachments.service";
import { AttachmentRequestSizeInterceptor } from "./attachment-request-size.interceptor";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";

// Storage ve dosya boyutu/sayısı limitleri AttachmentsModule'deki MulterModule
// seçeneklerinden gelir; toplam istek boyutu, gövde okunmadan önce
// AttachmentRequestSizeInterceptor ile kontrol edilir.
@ApiTags("attachments")
@Controller("projects/:projectId")
@UseInterceptors(AttachmentRequestSizeInterceptor)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post("results/:resultId/attachments")
  @UseInterceptors(FilesInterceptor("files"))
  uploadForResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("resultId") resultId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.attachmentsService.upload(
      user.id,
      projectId,
      { resultId },
      files,
    );
  }

  @Post("step-results/:stepResultId/attachments")
  @UseInterceptors(FilesInterceptor("files"))
  uploadForStepResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("stepResultId") stepResultId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.attachmentsService.upload(
      user.id,
      projectId,
      { stepResultId },
      files,
    );
  }

  @Post("defects/:defectId/attachments")
  @UseInterceptors(FilesInterceptor("files"))
  uploadForDefect(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("defectId") defectId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.attachmentsService.upload(
      user.id,
      projectId,
      { defectId },
      files,
    );
  }

  @Get("attachments/:attachmentId")
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("attachmentId") attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { attachment, filePath, contentType } =
      await this.attachmentsService.getForDownload(
        user.id,
        projectId,
        attachmentId,
      );
    // res.attachment, ASCII dışı karakterli adlar için RFC 6266 `filename*=UTF-8''…`
    // üretir; ham adı header'a yazmak "ş/ğ/ı" içeren adlarda 500'e yol açıyordu.
    // Content-Type istemcinin bildirdiği değerden değil, uzantıdan türetilir.
    res.attachment(attachment.fileName);
    res.setHeader("Content-Type", contentType);
    return new StreamableFile(fs.createReadStream(filePath));
  }
}
