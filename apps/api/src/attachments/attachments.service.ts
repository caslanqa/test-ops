import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { createReadStream } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import {
  attachmentExtension,
  attachmentMimeType,
  normalizeUploadedFileName,
} from "./attachments.constants";

const WRITE_ROLES: ProjectRole[] = [
  ProjectRole.ADMIN,
  ProjectRole.TESTER,
  ProjectRole.AUTOMATION,
];

export interface AttachmentTarget {
  resultId?: string;
  stepResultId?: string;
  defectId?: string;
}

/** Dosyayı belleğe almadan SHA-256 özetini hesaplar. */
async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Multer'ın geçici dizine yazdığı dosyaları doğrular ve kalıcı konuma taşır
   * (FR-045/FR-046). Tüm doğrulamalar herhangi bir dosya taşınmadan önce yapılır;
   * reddedilen veya taşınamayan geçici dosyalar `finally` içinde silinir.
   */
  async upload(
    userId: string,
    projectId: string,
    target: AttachmentTarget,
    files: Express.Multer.File[] | undefined,
  ) {
    const uploaded = files ?? [];
    // Ad; doğrulama mesajlarında, DB kaydında ve indirmede tutarlı olsun diye
    // ilk adımda düzeltilir.
    for (const file of uploaded) {
      file.originalname = normalizeUploadedFileName(file.originalname);
    }
    try {
      await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
        userId,
        projectId,
        WRITE_ROLES,
      );
      await this.assertTargetBelongsToProject(projectId, target);
      this.validateFiles(uploaded);

      const baseDir = this.config.get<string>("attachments.dir")!;
      await fs.mkdir(path.join(baseDir, projectId), { recursive: true });

      const created = [];
      for (const file of uploaded) {
        const checksum = await sha256File(file.path);
        const safeName = file.originalname.replace(/[^\w.\-]/g, "_");
        const storageKey = path.join(
          projectId,
          `${crypto.randomUUID()}-${safeName}`,
        );
        const finalPath = path.join(baseDir, storageKey);
        // Geçici dizin aynı volume içinde olduğundan rename atomiktir.
        await fs.rename(file.path, finalPath);
        try {
          created.push(
            await this.prisma.attachment.create({
              data: {
                uploaderUserId: userId,
                resultId: target.resultId,
                stepResultId: target.stepResultId,
                defectId: target.defectId,
                fileName: file.originalname,
                mimeType: attachmentMimeType(file.originalname),
                sizeBytes: file.size,
                checksumSha256: checksum,
                storageKey,
              },
            }),
          );
        } catch (error) {
          // Metadata yazılamadıysa sahipsiz dosya bırakma.
          await fs.rm(finalPath, { force: true });
          throw error;
        }
      }
      return created;
    } finally {
      await Promise.all(
        uploaded.map((file) => fs.rm(file.path, { force: true })),
      );
    }
  }

  async getForDownload(
    userId: string,
    projectId: string,
    attachmentId: string,
  ) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) {
      throw new NotFoundException("Attachment not found");
    }
    await this.assertTargetBelongsToProject(projectId, {
      resultId: attachment.resultId ?? undefined,
      stepResultId: attachment.stepResultId ?? undefined,
      defectId: attachment.defectId ?? undefined,
    });
    const baseDir = this.config.get<string>("attachments.dir")!;
    const filePath = path.join(baseDir, attachment.storageKey);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException("Attachment file is missing from storage");
    }
    // Eski kayıtlar istemcinin bildirdiği MIME tipini taşıyabilir; bu yüzden
    // sunulacak tip her indirmede uzantıdan yeniden türetilir.
    return {
      attachment,
      filePath,
      contentType: attachmentMimeType(attachment.fileName),
    };
  }

  /** Sayı, toplam/tekil boyut ve uzantı sınırlarını tüm dosyalar için uygular (FR-045, bölüm 8). */
  private validateFiles(files: Express.Multer.File[]) {
    const maxFiles = this.config.get<number>("attachments.maxFilesPerRequest")!;
    const maxFileSize = this.config.get<number>(
      "attachments.maxFileSizeBytes",
    )!;
    const maxRequestSize = this.config.get<number>(
      "attachments.maxRequestSizeBytes",
    )!;
    const allowedExtensions = new Set(
      this.config.get<string[]>("attachments.allowedExtensions")!,
    );

    if (files.length === 0) {
      throw new BadRequestException("At least one file is required");
    }
    if (files.length > maxFiles) {
      throw new BadRequestException(
        `At most ${maxFiles} files can be uploaded per request`,
      );
    }
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > maxRequestSize) {
      throw new BadRequestException(
        `Total upload size exceeds ${maxRequestSize} bytes per request`,
      );
    }
    for (const file of files) {
      if (file.size > maxFileSize) {
        throw new BadRequestException(
          `${file.originalname} exceeds the ${maxFileSize}-byte per-file limit`,
        );
      }
      const extension = attachmentExtension(file.originalname);
      if (!allowedExtensions.has(extension)) {
        throw new UnsupportedMediaTypeException(
          `${file.originalname}: file type not allowed (${extension ? `.${extension}` : "no extension"}). ` +
            `Allowed: ${[...allowedExtensions].join(", ")}`,
        );
      }
    }
  }

  private async assertTargetBelongsToProject(
    projectId: string,
    target: AttachmentTarget,
  ) {
    if (target.resultId) {
      const result = await this.prisma.result.findUnique({
        where: { id: target.resultId },
        include: { runCase: { include: { run: true } } },
      });
      if (!result || result.runCase.run.projectId !== projectId) {
        throw new NotFoundException("Result not found");
      }
    }
    if (target.stepResultId) {
      const stepResult = await this.prisma.stepResult.findUnique({
        where: { id: target.stepResultId },
        include: {
          result: { include: { runCase: { include: { run: true } } } },
        },
      });
      if (
        !stepResult ||
        stepResult.result.runCase.run.projectId !== projectId
      ) {
        throw new NotFoundException("Step result not found");
      }
    }
    if (target.defectId) {
      const defect = await this.prisma.defect.findUnique({
        where: { id: target.defectId },
      });
      if (!defect || defect.projectId !== projectId) {
        throw new NotFoundException("Defect not found");
      }
    }
  }
}
