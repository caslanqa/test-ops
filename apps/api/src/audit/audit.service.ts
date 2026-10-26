import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditEntry {
  userId: string;
  workspaceId?: string;
  projectId?: string;
  /** What happened, e.g. "ai.settings.updated". */
  action: string;
  /** The kind of record it happened to, e.g. "ai_settings". */
  entityType: string;
  entityId?: string;
  /** Facts about the change; never a secret. */
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes the audit log (the `audit_log` table). The AI assistant is its first writer; the wider
 * audit gap in PLAN.md stays open until other changes record themselves too.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({ data: entry });
  }
}
