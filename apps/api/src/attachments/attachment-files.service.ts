import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs/promises";
import * as path from "path";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Removes attachment files from the storage volume when their database rows are removed by
 * a cascade (deleting a result, run, defect or workspace). Rows go first and files after, so
 * a failure leaves an orphaned file rather than a row that points at nothing.
 */
@Injectable()
export class AttachmentFilesService {
  private readonly logger = new Logger(AttachmentFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Storage keys of the attachments matching `where`; call before the rows are deleted. */
  async keysFor(where: Prisma.AttachmentWhereInput): Promise<string[]> {
    const rows = await this.prisma.attachment.findMany({
      where,
      select: { storageKey: true },
    });
    return rows.map((row) => row.storageKey);
  }

  /** Deletes the files; a missing file is fine and other failures are logged, not thrown. */
  async removeFiles(keys: string[]): Promise<void> {
    const baseDir = this.config.get<string>("attachments.dir")!;
    await Promise.all(
      keys.map(async (key) => {
        try {
          await fs.rm(path.join(baseDir, key), { force: true });
        } catch (error) {
          this.logger.warn(`Could not remove attachment file ${key}: ${String(error)}`);
        }
      }),
    );
  }
}
