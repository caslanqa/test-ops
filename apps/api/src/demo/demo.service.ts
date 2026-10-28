import { randomBytes } from "crypto";
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AutomationStatus,
  CasePriority,
  CaseType,
  DefectSeverity,
  Prisma,
  ResultStatus,
  RunSource,
  WorkspaceRole,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { SuitesService } from "../suites/suites.service";
import { TestCasesService } from "../test-cases/test-cases.service";
import { RequirementsService } from "../requirements/requirements.service";
import { MilestonesService } from "../milestones/milestones.service";
import { PlansService } from "../plans/plans.service";
import { RunsService } from "../runs/runs.service";
import { ResultsService } from "../runs/results.service";
import { DefectsService } from "../defects/defects.service";
import { LEGACY_DEMO_USER_ID, LEGACY_DEMO_WORKSPACE_ID } from "./demo.constants";
import data from "./demo-shop.json";

/**
 * Gives every user a DEMO workspace of their own (DEMO_WORKSPACE, on unless set to false), where
 * they can try everything TestOps does on example data: run the plan, assign cases, record results,
 * file defects. It holds an example shop's project: suites, cases with steps, requirements, a
 * milestone, a plan, a manual run with step results, an automated Playwright run and defects linked
 * to failures. The data is demo-shop.json; the shop and its tests are in examples/demo-shop.
 *
 * The workspace is made the first time the user lists their workspaces, with them as its admin, and
 * everything in it is written through the same services as the API, with the same rules. It is made
 * once per user (users.demoCreatedAt): a user who deleted theirs makes a fresh one from the
 * Workspaces page (POST /demo-workspace).
 */
@Injectable()
export class DemoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoService.name);
  readonly enabled: boolean;
  /** Users whose first demo is made (or was claimed), so listing workspaces doesn't ask again. */
  private readonly handled = new Set<string>();
  /** Demos being made right now: parallel requests of one user wait for the same one. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly suites: SuitesService,
    private readonly cases: TestCasesService,
    private readonly requirements: RequirementsService,
    private readonly milestones: MilestonesService,
    private readonly plans: PlansService,
    private readonly runs: RunsService,
    private readonly results: ResultsService,
    private readonly defects: DefectsService,
  ) {
    this.enabled = config.get<boolean>("demo.enabled") ?? false;
  }

  async onApplicationBootstrap() {
    try {
      await this.removeLegacySharedDemo();
    } catch (error) {
      // Harmless to keep: nobody can reach it any more. The next start tries again.
      this.logger.error(
        `The shared demo workspace of earlier versions could not be removed: ${error instanceof Error ? error.message : error}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Makes the user's first demo workspace, unless it was made before. Called when the user lists
   * their workspaces, so it is there when they first look; a failure is logged and tried again on
   * the next listing, and never fails the listing itself.
   */
  async ensureFor(userId: string): Promise<void> {
    // `handled` is set as soon as the demo is claimed, before it is whole: while one is being made, wait for it.
    if (!this.enabled || (this.handled.has(userId) && !this.inFlight.has(userId))) return;
    await this.once(userId, async () => {
      // Claimed in the database first, so a second app process or a retry never makes another.
      const claimed = await this.prisma.user.updateMany({
        where: { id: userId, demoCreatedAt: null },
        data: { demoCreatedAt: new Date() },
      });
      this.handled.add(userId);
      if (claimed.count === 0) return;
      try {
        await this.createFor(userId);
      } catch (error) {
        this.handled.delete(userId);
        await this.prisma.user.updateMany({ where: { id: userId }, data: { demoCreatedAt: null } });
        this.logger.error(
          `The demo workspace of user ${userId} could not be made: ${error instanceof Error ? error.message : error}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    });
  }

  /** The demo workspace the user administers, if they have one. */
  currentDemo(userId: string) {
    return this.prisma.workspace.findFirst({
      where: { isDemo: true, members: { some: { userId, role: WorkspaceRole.ADMIN } } },
      select: { id: true, name: true },
    });
  }

  /** A fresh demo workspace for a user who deleted theirs (POST /demo-workspace). */
  async recreate(userId: string) {
    if (!this.enabled) throw new NotFoundException("This server doesn't make demo workspaces (DEMO_WORKSPACE=false).");
    if (this.inFlight.has(userId) || (await this.currentDemo(userId))) {
      throw new ConflictException("You already have a demo workspace.");
    }
    return this.once(userId, async () => {
      const workspace = await this.createFor(userId);
      await this.prisma.user.update({ where: { id: userId }, data: { demoCreatedAt: new Date() } });
      this.handled.add(userId);
      return workspace;
    });
  }

  /** Runs `make` for the user unless a demo of theirs is already being made; then waits for that one. */
  private async once<T>(userId: string, make: () => Promise<T>): Promise<T | undefined> {
    const pending = this.inFlight.get(userId);
    if (pending) {
      await pending.catch(() => undefined);
      return undefined;
    }
    const run = make().finally(() => this.inFlight.delete(userId));
    this.inFlight.set(userId, run);
    return run;
  }

  /** Makes a demo workspace with the user as its admin; a failure leaves nothing half-made. */
  private async createFor(userId: string) {
    const workspace = await this.prisma.workspace.create({
      data: {
        name: data.workspace.name,
        // Slugs are unique across the server, and every user has a DEMO.
        slug: `${data.workspace.slug}-${randomBytes(4).toString("hex")}`,
        isDemo: true,
        members: { create: { userId, role: WorkspaceRole.ADMIN } },
      },
    });
    try {
      await this.fill(userId, workspace.id);
    } catch (error) {
      await this.deleteWorkspace(workspace.id);
      throw error;
    }
    return workspace;
  }

  /** The example shop's project, written as the user would through the API. */
  private async fill(userId: string, workspaceId: string) {
    const { id: projectId } = await this.projects.create(userId, workspaceId, data.project);

    // The demo-ref tag maps fixture tests to each user's freshly generated TestOps case IDs in demo CI.
    const caseIds = new Map<string, string>();
    for (const suite of data.suites) {
      const { id: suiteId } = await this.suites.create(userId, projectId, { name: suite.name, description: suite.description });
      for (const c of suite.cases) {
        const key = "key" in c ? c.key : undefined;
        const testCase = await this.cases.create(userId, projectId, {
          suiteId,
          title: c.title,
          preconditions: "preconditions" in c ? c.preconditions : undefined,
          description: "description" in c ? c.description : undefined,
          priority: ("priority" in c ? c.priority : "MEDIUM") as CasePriority,
          type: ("type" in c ? c.type : "FUNCTIONAL") as CaseType,
          automationStatus: ("automationStatus" in c ? c.automationStatus : "AUTOMATED") as AutomationStatus,
          tags: key ? [`demo-ref:${key}`, `e2e:${key}`, suite.name.toLowerCase()] : [suite.name.toLowerCase()],
          steps: c.steps,
        });
        caseIds.set(key ?? c.title, testCase.id);
      }
    }
    const caseId = (ref: string) => {
      const id = caseIds.get(ref);
      if (!id) throw new Error(`demo-shop.json refers to an unknown case "${ref}"`);
      return id;
    };

    for (const r of data.requirements) {
      const requirement = await this.requirements.create(userId, projectId, { title: r.title, externalRef: r.externalRef });
      await this.requirements.linkCases(userId, projectId, requirement.id, r.cases.map(caseId));
    }

    const dueDate = new Date(Date.now() + data.milestone.dueInDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const milestone = await this.milestones.create(userId, projectId, { name: data.milestone.name, dueDate });

    await this.plans.create(userId, projectId, {
      ...data.plan,
      milestoneId: milestone.id,
      testCaseIds: [...caseIds.values()],
    });

    // A manual run a tester has partly done: step results, a failure, a blocked case, one untested.
    const manual = data.manualRun;
    const manualRun = await this.runs.create(userId, projectId, {
      title: manual.title,
      description: manual.description,
      milestoneId: milestone.id,
      environment: manual.environment,
      build: manual.build,
      source: RunSource.MANUAL,
      testCaseIds: manual.cases.map(caseId),
    });
    for (const r of manual.results) {
      await this.results.submit(userId, projectId, manualRun.id, {
        testCaseId: caseId(r.case),
        status: r.status as ResultStatus,
        comment: "comment" in r ? r.comment : undefined,
        durationMs: r.durationMs,
        source: "MANUAL",
        stepResults: r.stepResults.map((s) => ({
          stepPosition: s.stepPosition,
          status: s.status as ResultStatus,
          comment: "comment" in s ? s.comment : undefined,
        })),
      });
    }

    // An automated run as the Playwright reporter sends it from CI, completed once its failure is
    // linked to the defect below.
    const auto = data.automatedRun;
    const automatedRun = await this.runs.create(userId, projectId, {
      title: auto.title,
      description: auto.description,
      milestoneId: milestone.id,
      environment: auto.environment,
      build: auto.build,
      source: RunSource.CI,
      testCaseIds: auto.results.map((r) => caseId(r.key)),
    });
    await this.results.bulkSubmit(
      userId,
      projectId,
      automatedRun.id,
      auto.results.map((r) => ({
        testCaseId: caseId(r.key),
        status: r.status as ResultStatus,
        comment: "comment" in r ? r.comment : undefined,
        durationMs: r.durationMs,
        source: "AUTOMATION",
        automationSourceLabel: "Playwright",
        externalTestId: r.test,
      })),
    );

    const runIds = { manual: manualRun.id, automated: automatedRun.id };
    for (const d of data.defects) {
      const resultIds = await Promise.all(
        d.results.map((link) => this.latestResultId(runIds[link.run as keyof typeof runIds], caseId(link.case))),
      );
      await this.defects.create(userId, projectId, {
        title: d.title,
        description: d.description,
        severity: d.severity as DefectSeverity,
        tags: d.tags,
        resultIds: resultIds.filter((id): id is string => id !== null),
      });
    }

    await this.runs.complete(userId, projectId, automatedRun.id);
  }

  /** As in WorkspacesService.remove: runs go first, since run cases point at test cases without a cascade. */
  private async deleteWorkspace(workspaceId: string) {
    await this.prisma.$transaction([
      this.prisma.testRun.deleteMany({ where: { project: { workspaceId } } }),
      this.prisma.workspace.delete({ where: { id: workspaceId } }),
    ]);
  }

  /** The shared, read-only DEMO of earlier versions and its system user; every user now has their own. */
  private async removeLegacySharedDemo() {
    const legacy = await this.prisma.workspace.findUnique({
      where: { id: LEGACY_DEMO_WORKSPACE_ID },
      select: { id: true },
    });
    if (legacy) {
      await this.deleteWorkspace(legacy.id);
      this.logger.log("Removed the shared DEMO workspace of earlier versions; every user now gets a demo of their own.");
    }
    await this.prisma.user.deleteMany({ where: { id: LEGACY_DEMO_USER_ID } });
  }

  private async latestResultId(runId: string, testCaseId: string): Promise<string | null> {
    const result = await this.prisma.result.findFirst({
      where: { isLatest: true, runCase: { runId, testCaseId } } satisfies Prisma.ResultWhereInput,
      select: { id: true },
    });
    return result?.id ?? null;
  }
}
