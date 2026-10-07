import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { createReadStream } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { Prisma, ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import {
  attachmentExtension,
  attachmentMimeType,
  normalizeUploadedFileName,
} from "./attachments.constants";
import { ListAttachmentsQueryDto } from "./dto/list-attachments-query.dto";
import { pageArgs } from "../common/pagination";

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

/** Computes the file's SHA-256 digest without loading it into memory. */
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
   * Validates the files Multer wrote to the temp directory and moves them to permanent
   * storage (FR-045/FR-046). All validation happens before any file is moved;
   * rejected or unmovable temp files are deleted in `finally`.
   */
  async upload(
    userId: string,
    projectId: string,
    target: AttachmentTarget,
    files: Express.Multer.File[] | undefined,
  ) {
    const uploaded = files ?? [];
    // The name is fixed up first so it is consistent across validation messages,
    // the DB record and downloads.
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
        // The temp directory is on the same volume, so the rename is atomic.
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
          // If the metadata could not be written, do not leave an orphaned file.
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
    // Older records may carry the client-declared MIME type; so the type to
    // serve is re-derived from the extension on every download.
    return {
      attachment,
      filePath,
      contentType: attachmentMimeType(attachment.fileName),
    };
  }

  /** Applies the count, total/per-file size and extension limits to all files (FR-045, section 8). */
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

  /** Attachments of results, steps and defects in the project (metadata only; download by id). */
  async list(userId: string, projectId: string, query: ListAttachmentsQueryDto) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const inProject = {
      OR: [
        { result: { runCase: { run: { projectId } } } },
        { stepResult: { result: { runCase: { run: { projectId } } } } },
        { defect: { projectId } },
      ],
    } satisfies Prisma.AttachmentWhereInput;
    const where: Prisma.AttachmentWhereInput = {
      AND: [
        inProject,
        {
          resultId: query.resultId,
          defectId: query.defectId,
          fileName: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
        },
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attachment.findMany({
        where,
        // The storage key is an internal path and is never exposed.
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          checksumSha256: true,
          resultId: true,
          stepResultId: true,
          defectId: true,
          uploaderUserId: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.attachment.count({ where }),
    ]);
    return { items, total };
  }

  /** Deletes the attachment and its file; testers and automation may delete only their own uploads. */
  async remove(userId: string, projectId: string, attachmentId: string) {
    const access = await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
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
    if (access.role !== ProjectRole.ADMIN && attachment.uploaderUserId !== userId) {
      throw new ForbiddenException("You can only delete attachments you uploaded");
    }
    await this.prisma.attachment.delete({ where: { id: attachmentId } });
    await fs.rm(
      path.join(this.config.get<string>("attachments.dir")!, attachment.storageKey),
      { force: true },
    );
  }
}
