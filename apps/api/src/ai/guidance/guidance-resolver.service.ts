import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AiGuidance, AiGuidanceStep } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AiSettingsService } from "../ai-settings.service";
import { GUIDANCE_BUDGET_TOKENS, GUIDANCE_LIMITS } from "./guidance-limits";
import {
  pickForStep,
  renderTeamGuidance,
  type DroppedGuidance,
  type GuidanceCandidate,
  type GuidanceSelection,
} from "./resolve-guidance";

/** What one step of a project would be sent. */
export interface ResolvedGuidance {
  /** In prompt order. */
  used: GuidanceCandidate[];
  dropped: DroppedGuidance[];
  usedTokens: number;
  /** The most tokens of guidance a step may carry; 0 means no limit. */
  budgetTokens: number;
  /** The exact block for the step's system prompt; empty when nothing applies. */
  prompt: string;
}

const toCandidate = (row: AiGuidance): GuidanceCandidate => ({
  ref: row.id,
  scope: row.workspaceId ? "WORKSPACE" : "PROJECT",
  title: row.title,
  body: row.body,
  version: row.version,
  steps: row.steps,
  priority: row.priority,
});

/**
 * Which guidance a project's steps use: the pure rules are in resolve-guidance.ts; this reads what they need.
 * Nothing here checks who is asking: the caller does.
 */
@Injectable()
export class GuidanceResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
  ) {}

  /** The token budget of the AI setting the project uses (its own, else its workspace's), or the default with none. */
  async budgetFor(projectId: string): Promise<number> {
    const { settings } = await this.settings.resolve(projectId);
    return settings?.guidanceBudgetTokens ?? GUIDANCE_BUDGET_TOKENS.default;
  }

  /**
   * Everything the selection allows, before the step and the budget narrow it. `EFFECTIVE` is the workspace's
   * guidance that is on and not switched off for this project, and the project's that is on; `LIST` is exactly the
   * named guidance, switched on or not, as long as the project can see it (its own, or its workspace's).
   */
  async candidatesFor(projectId: string, selection: GuidanceSelection): Promise<GuidanceCandidate[]> {
    if (selection.mode === "NONE") return [];
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    if (!project) throw new NotFoundException("Project not found");

    if (selection.mode === "LIST") {
      const ids = [...new Set(selection.ids ?? [])];
      if (ids.length === 0) throw new BadRequestException("Name at least one guidance to use");
      if (ids.length > GUIDANCE_LIMITS.selectionIds) {
        throw new BadRequestException(`Name at most ${GUIDANCE_LIMITS.selectionIds} guidance`);
      }
      const rows = await this.prisma.aiGuidance.findMany({
        where: { id: { in: ids }, OR: [{ projectId }, { workspaceId: project.workspaceId }] },
      });
      // Another scope's id answers like a missing one, so ids can't be probed.
      if (rows.length !== ids.length) throw new NotFoundException("Guidance not found");
      return rows.map(toCandidate);
    }

    const [shared, own, switchedOff] = await Promise.all([
      this.prisma.aiGuidance.findMany({ where: { workspaceId: project.workspaceId, enabled: true } }),
      this.prisma.aiGuidance.findMany({ where: { projectId, enabled: true } }),
      this.prisma.aiGuidanceToggle.findMany({
        where: { projectId, enabled: false, guidanceId: { not: null } },
        select: { guidanceId: true },
      }),
    ]);
    const off = new Set(switchedOff.map((toggle) => toggle.guidanceId));
    return [...shared.filter((row) => !off.has(row.id)), ...own].map(toCandidate);
  }

  /** What one step of the project would be sent under a selection, within the budget. */
  async resolve(projectId: string, step: AiGuidanceStep, selection: GuidanceSelection): Promise<ResolvedGuidance> {
    const [candidates, budgetTokens] = await Promise.all([this.candidatesFor(projectId, selection), this.budgetFor(projectId)]);
    const picked = pickForStep(candidates, step, budgetTokens);
    return {
      ...picked,
      budgetTokens,
      prompt: renderTeamGuidance(picked.used.map(({ title, body }) => ({ title, body }))),
    };
  }
}
