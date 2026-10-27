import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ProjectRole, type Prisma } from "@prisma/client";
import { AuditService } from "../../audit/audit.service";
import { AccessControlService } from "../../common/access-control.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AiRunsService } from "../ai-runs.service";
import { snapshotOf } from "../ai-snapshot";
import { GuidanceResolver } from "../guidance/guidance-resolver.service";
import { buildSnapshot, sameSelections, type GuidanceSnapshot } from "../guidance/guidance-snapshot";
import { StartComparisonDto, VerdictDto } from "./dto/start-comparison.dto";

/** Starting and judging a comparison needs the right to start a run, as approving one does. */
const WRITE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER];
const DAY_MS = 24 * 60 * 60 * 1000;
const ENTITY = "ai_run_comparison";
/** A verdict can be given once both runs have drafts to compare. */
const WITH_DRAFTS = ["AWAITING_APPROVAL", "COMPLETED"];

/** How a guidance did across the judged comparisons it took part in. */
export interface GuidanceStats {
  ref: string;
  title: string;
  /** Judged comparisons in which it was sent on either side. */
  comparisons: number;
  /** Of those, the ones whose verdict preferred a side it was sent on (a verdict of neither prefers none). */
  preferred: number;
}

/**
 * Two runs of one requirement under two selections of guidance, and a person's verdict on which drafted better:
 * the in-app way to find out whether a guidance helps. Both runs are made together or not at all, and count against
 * the daily limit; each keeps its own snapshot of what it was sent, like any run.
 */
@Injectable()
export class ComparisonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly audit: AuditService,
    private readonly runs: AiRunsService,
    private readonly resolver: GuidanceResolver,
  ) {}

  async start(userId: string, projectId: string, dto: StartComparisonDto) {
    const { access, source, settings } = await this.runs.prepareStart(userId, projectId, dto.requirementId);
    const a = this.runs.selectionOf(dto.a);
    const b = this.runs.selectionOf(dto.b);
    if (sameSelections(a, b)) throw new BadRequestException("The two sides ask for the same guidance, so there is nothing to compare");
    // As for a single run: only an admin may name guidance that is not in effect.
    const options = { inEffectOnly: access.role !== ProjectRole.ADMIN };
    const [snapshotA, snapshotB] = await Promise.all([
      buildSnapshot(this.resolver, projectId, a, options),
      buildSnapshot(this.resolver, projectId, b, options),
    ]);

    const made = await this.prisma.$transaction(async (tx) => {
      // The same lock as a single start, so starts of either kind are counted one at a time per person.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-run-start:${userId}`}))`;
      const recent = await tx.aiWorkflowRun.count({ where: { createdById: userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } } });
      // Two runs, or none: a limit with room for one refuses the whole comparison.
      if (recent + 2 > settings.maxRunsPerUserPerDay) {
        throw new HttpException(
          `A comparison starts two runs, and you have started ${recent} in the last 24 hours, which leaves too little of the ${settings.maxRunsPerUserPerDay} this setting allows`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const comparison = await tx.aiRunComparison.create({ data: { projectId, requirementId: dto.requirementId, createdById: userId } });
      const side = (comparisonSide: "A" | "B", snapshot: GuidanceSnapshot) =>
        tx.aiWorkflowRun.create({
          data: {
            type: "REQUIREMENT_TO_CASES",
            projectId,
            createdById: userId,
            input: { requirementId: dto.requirementId, extraContext: dto.extraContext ?? null },
            providerSnapshot: snapshotOf(source, settings),
            guidance: snapshot as unknown as Prisma.InputJsonValue,
            comparisonId: comparison.id,
            comparisonSide,
          },
        });
      const runA = await side("A", snapshotA);
      const runB = await side("B", snapshotB);
      return { id: comparison.id, runs: { A: runA.id, B: runB.id } };
    });
    await this.audit.record({
      userId,
      projectId,
      action: "ai.comparison.started",
      entityType: ENTITY,
      entityId: made.id,
      metadata: { requirementId: dto.requirementId, a: a.mode, b: b.mode, runs: made.runs },
    });
    return made;
  }

  /** The comparison with both runs as run views (what each was sent, its drafts) and the verdict, if there is one. */
  async get(userId: string, projectId: string, comparisonId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(userId, projectId);
    const row = await this.prisma.aiRunComparison.findFirst({
      where: { id: comparisonId, projectId },
      include: { runs: { select: { id: true, comparisonSide: true } } },
    });
    if (!row) throw new NotFoundException("Comparison not found");
    const runOf = (side: "A" | "B") => {
      const run = row.runs.find((candidate) => candidate.comparisonSide === side);
      if (!run) throw new NotFoundException("Comparison not found");
      return this.runs.get(userId, projectId, run.id);
    };
    const [A, B] = await Promise.all([runOf("A"), runOf("B")]);
    const { runs: _runs, ...fields } = row;
    return { ...fields, runs: { A, B } };
  }

  /**
   * Records which side drafted better. Both runs must have drafts. Whoever gave a verdict can change it, and so can a
   * project admin; no other Tester can. The note is kept with the verdict and never audited.
   */
  async judge(userId: string, projectId: string, comparisonId: string, dto: VerdictDto) {
    const access = await this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, projectId, WRITE_ROLES);
    const row = await this.prisma.aiRunComparison.findFirst({
      where: { id: comparisonId, projectId },
      include: { runs: { select: { status: true } } },
    });
    if (!row) throw new NotFoundException("Comparison not found");
    if (row.runs.length !== 2 || row.runs.some((run) => !WITH_DRAFTS.includes(run.status))) {
      throw new ConflictException("Both runs need drafts before there can be a verdict");
    }
    if (row.judgedById && row.judgedById !== userId && access.role !== ProjectRole.ADMIN) {
      throw new ForbiddenException("Only whoever gave the verdict, or a project admin, can change it");
    }
    await this.prisma.aiRunComparison.update({
      where: { id: row.id },
      data: { preferred: dto.preferred, note: dto.note?.trim() || null, judgedById: userId, judgedAt: new Date() },
    });
    await this.audit.record({
      userId,
      projectId,
      action: "ai.comparison.judged",
      entityType: ENTITY,
      entityId: row.id,
      metadata: { preferred: dto.preferred },
    });
    return { id: row.id, preferred: dto.preferred };
  }

  /** Per guidance: the judged comparisons it was sent in, and how many of them preferred a side it was sent on. */
  async stats(userId: string, projectId: string): Promise<GuidanceStats[]> {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(userId, projectId);
    // Counted in the database: a run's snapshot holds the text of every guidance it was sent, and reading all of that
    // for every judged comparison to count titles would grow without bound. A guidance sent on both sides of a
    // comparison says nothing about which side drafted better, so only one that was on exactly one side counts there.
    const rows = await this.prisma.$queryRaw<{ ref: string; title: string; comparisons: bigint; preferred: bigint }[]>`
      WITH sent AS (
        SELECT c.id AS cid, c.preferred::text AS preferred, r."comparisonSide"::text AS side,
               item.key AS ref, item.value->>'title' AS title
        FROM ai_run_comparisons c
        JOIN ai_workflow_runs r ON r."comparisonId" = c.id
        CROSS JOIN LATERAL jsonb_each(COALESCE(r.guidance->'items', '{}'::jsonb)) AS item
        WHERE c."projectId" = ${projectId} AND c.preferred IS NOT NULL
      ), on_one_side AS (
        SELECT cid, ref, max(title) AS title, max(preferred) AS preferred, min(side) AS side
        FROM sent GROUP BY cid, ref HAVING count(*) = 1
      )
      SELECT ref, max(title) AS title, count(*) AS comparisons, count(*) FILTER (WHERE preferred = side) AS preferred
      FROM on_one_side GROUP BY ref ORDER BY count(*) DESC, max(title) ASC`;
    return rows.map((row) => ({ ref: row.ref, title: row.title, comparisons: Number(row.comparisons), preferred: Number(row.preferred) }));
  }
}
