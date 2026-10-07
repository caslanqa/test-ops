import * as fs from "fs";
import { Controller, Delete, Get, HttpCode, Param, Post, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AttachmentsService } from "./attachments.service";
import { AttachmentRequestSizeInterceptor } from "./attachment-request-size.interceptor";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";
import { ListAttachmentsQueryDto } from "./dto/list-attachments-query.dto";
import { PagedResponse, sendPage } from "../common/pagination";

// Storage and file size/count limits come from the MulterModule options in
// AttachmentsModule; the total request size is checked by
// AttachmentRequestSizeInterceptor before the body is read.
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
    // res.attachment produces RFC 6266 `filename*=UTF-8''…` for non-ASCII names;
    // writing the raw name into the header caused a 500 for names with characters
    // outside Latin-1 (e.g. "ł", "č", "中"), which Node rejects in header values.
    // Content-Type is derived from the extension, not from the client-declared value.
    res.attachment(attachment.fileName);
    res.setHeader("Content-Type", contentType);
    return new StreamableFile(fs.createReadStream(filePath));
  }

  @Get("attachments")
  @PagedResponse()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: ListAttachmentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.attachmentsService.list(user.id, projectId, query));
  }

  /** Deletes an attachment and its file (project admins, or the uploader). */
  @Delete("attachments/:attachmentId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("attachmentId") attachmentId: string,
  ) {
    await this.attachmentsService.remove(user.id, projectId, attachmentId);
  }
}
