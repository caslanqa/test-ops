import { randomBytes } from "crypto";
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
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
import * as bcrypt from "bcryptjs";
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
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "./demo.constants";
import data from "./demo-shop.json";

/**
 * Builds the DEMO workspace that every signed-in user can look around in, read-only, to see what
 * TestOps does (DEMO_WORKSPACE, on unless set to false). It holds an example shop's project:
 * suites, cases with steps, requirements, a milestone, a plan, a manual run with step results, an
 * automated Playwright run and defects linked to failures. The data is demo-shop.json; the shop and
 * its tests are in examples/demo-shop.
 *
 * It runs at startup. A system user owns the demo; it has an unknown random password, so nobody
 * can sign in as it, and visitors can't change anything (AccessControlService). Whatever exists
 * is found by name and left alone, so restarts and upgrades only add what is missing. Everything
 * is written through the same services as the API, with the same rules.
 */
@Injectable()
export class DemoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly config: ConfigService,
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
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.get<boolean>("demo.enabled")) return;
    try {
      const added = await this.build();
      if (added > 0) this.logger.log(`Demo workspace: added ${added} records.`);
    } catch (error) {
      // The app works without the demo; the next start tries again.
      this.logger.error(
        `The demo workspace could not be built: ${error instanceof Error ? error.message : error}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Creates whatever is missing and returns how many records were added. */
  private async build(): Promise<number> {
    let added = 0;
    const note = <T>(record: T) => {
      added++;
      return record;
    };
    const userId = DEMO_USER_ID;
    await this.ensureOwner();

    const projectData = data.project;
    const project =
      (await this.prisma.project.findUnique({
        where: { workspaceId_key: { workspaceId: DEMO_WORKSPACE_ID, key: projectData.key } },
      })) ?? note(await this.projects.create(userId, DEMO_WORKSPACE_ID, projectData));
    const projectId = project.id;

    // Suites and cases. Cases are found by title; automated ones carry the tag e2e:<key> that
    // the Playwright reporter looks for.
    const suites = await this.prisma.suite.findMany({ where: { projectId } });
    const cases = await this.prisma.testCase.findMany({ where: { projectId } });
    const caseIds = new Map<string, string>();
    for (const suite of data.suites) {
      const suiteId =
        suites.find((s) => s.name === suite.name)?.id ??
        note(await this.suites.create(userId, projectId, { name: suite.name, description: suite.description })).id;
      for (const c of suite.cases) {
        const key = "key" in c ? c.key : undefined;
        const testCase =
          cases.find((existing) => existing.title === c.title) ??
          note(
            await this.cases.create(userId, projectId, {
              suiteId,
              title: c.title,
              preconditions: "preconditions" in c ? c.preconditions : undefined,
              description: "description" in c ? c.description : undefined,
              priority: ("priority" in c ? c.priority : "MEDIUM") as CasePriority,
              type: ("type" in c ? c.type : "FUNCTIONAL") as CaseType,
              automationStatus: ("automationStatus" in c ? c.automationStatus : "AUTOMATED") as AutomationStatus,
              tags: key ? [`e2e:${key}`, suite.name.toLowerCase()] : [suite.name.toLowerCase()],
              steps: c.steps,
            }),
          );
        caseIds.set(key ?? c.title, testCase.id);
      }
    }
    const caseId = (ref: string) => {
      const id = caseIds.get(ref);
      if (!id) throw new Error(`demo-shop.json refers to an unknown case "${ref}"`);
      return id;
    };

    const requirements = await this.prisma.requirement.findMany({ where: { projectId } });
    for (const r of data.requirements) {
      if (requirements.some((existing) => existing.title === r.title)) continue;
      const requirement = note(
        await this.requirements.create(userId, projectId, { title: r.title, externalRef: r.externalRef }),
      );
      await this.requirements.linkCases(userId, projectId, requirement.id, r.cases.map(caseId));
    }

    const dueDate = new Date(Date.now() + data.milestone.dueInDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const milestone =
      (await this.prisma.milestone.findFirst({ where: { projectId, name: data.milestone.name } })) ??
      note(await this.milestones.create(userId, projectId, { name: data.milestone.name, dueDate }));

    if (!(await this.prisma.testPlan.findFirst({ where: { projectId, title: data.plan.title } }))) {
      note(
        await this.plans.create(userId, projectId, {
          ...data.plan,
          milestoneId: milestone.id,
          testCaseIds: [...caseIds.values()],
        }),
      );
    }

    // A manual run a tester has partly done: step results, a failure, a blocked case, one untested.
    const manual = data.manualRun;
    let manualRun = await this.prisma.testRun.findFirst({ where: { projectId, title: manual.title } });
    if (!manualRun) {
      manualRun = note(
        await this.runs.create(userId, projectId, {
          title: manual.title,
          description: manual.description,
          milestoneId: milestone.id,
          environment: manual.environment,
          build: manual.build,
          source: RunSource.MANUAL,
          testCaseIds: manual.cases.map(caseId),
        }),
      );
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
    }

    // An automated run as the Playwright reporter sends it from CI. It is completed once its
    // failure is linked to the defect below.
    const auto = data.automatedRun;
    let automatedRun = await this.prisma.testRun.findFirst({ where: { projectId, title: auto.title } });
    if (!automatedRun) {
      automatedRun = note(
        await this.runs.create(userId, projectId, {
          title: auto.title,
          description: auto.description,
          milestoneId: milestone.id,
          environment: auto.environment,
          build: auto.build,
          source: RunSource.CI,
          testCaseIds: auto.results.map((r) => caseId(r.key)),
        }),
      );
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
    }

    const defects = await this.prisma.defect.findMany({ where: { projectId } });
    const runIds = { manual: manualRun.id, automated: automatedRun.id };
    for (const d of data.defects) {
      if (defects.some((existing) => existing.title === d.title)) continue;
      const resultIds = await Promise.all(
        d.results.map((link) => this.latestResultId(runIds[link.run as keyof typeof runIds], caseId(link.case))),
      );
      note(
        await this.defects.create(userId, projectId, {
          title: d.title,
          description: d.description,
          severity: d.severity as DefectSeverity,
          tags: d.tags,
          resultIds: resultIds.filter((id): id is string => id !== null),
        }),
      );
    }

    if (automatedRun.status === "OPEN") await this.runs.complete(userId, projectId, automatedRun.id);
    return added;
  }

  /**
   * The system user that owns the demo, and the workspace itself, both with fixed ids. The user's
   * email is random, so a sign-up can't collide with it, and its password is random and thrown
   * away, so nobody can sign in as it.
   */
  private async ensureOwner() {
    if (!(await this.prisma.user.findUnique({ where: { id: DEMO_USER_ID } }))) {
      await this.prisma.user.create({
        data: {
          id: DEMO_USER_ID,
          email: `demo-${randomBytes(6).toString("hex")}@testops.invalid`,
          displayName: "TestOps Demo",
          passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12),
        },
      });
    }
    if (!(await this.prisma.workspace.findUnique({ where: { id: DEMO_WORKSPACE_ID } }))) {
      // "demo" unless a workspace of someone else already has that slug.
      const taken = await this.prisma.workspace.findUnique({ where: { slug: data.workspace.slug } });
      const slug = taken ? `${data.workspace.slug}-${randomBytes(3).toString("hex")}` : data.workspace.slug;
      await this.prisma.workspace.create({ data: { id: DEMO_WORKSPACE_ID, name: data.workspace.name, slug } });
    }
    await this.prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId: DEMO_USER_ID } },
      update: { role: WorkspaceRole.ADMIN },
      create: { workspaceId: DEMO_WORKSPACE_ID, userId: DEMO_USER_ID, role: WorkspaceRole.ADMIN },
    });
  }

  private async latestResultId(runId: string, testCaseId: string): Promise<string | null> {
    const result = await this.prisma.result.findFirst({
      where: { isLatest: true, runCase: { runId, testCaseId } } satisfies Prisma.ResultWhereInput,
      select: { id: true },
    });
    return result?.id ?? null;
  }
}
